/**
 * AI Invoice Extraction Engine — Google Gemini (official `@google/genai` SDK).
 *
 * Sends a supplier invoice (PDF, JPEG, PNG, WebP, HEIC) to `gemini-2.5-flash`
 * with a strict `responseSchema` (structured output) and returns a normalised,
 * validated extraction: invoice header (fournisseur, ICE, n°, date, devise,
 * totaux HT / TVA / TTC) and line items classified as fixed assets vs.
 * consumables with a suggested accounting class.
 *
 * Ingestion:
 *   - ≤ 14 MB  → inline base64 part (Gemini's request cap is 20 MB after encoding)
 *   - > 14 MB  → Gemini Files API upload, polled until ACTIVE, deleted afterwards
 *
 * Robustness:
 *   - exponential back-off on 429 / 5xx / network / timeouts / empty responses
 *   - explicit errors for blocked content, truncated output, invalid key / model
 *   - Zod re-validation + arithmetic consistency checks (see invoice-normalization)
 *
 * Server-only usage (API key): import it from Route Handlers / Server Actions.
 */
import {
  ApiError,
  FileState,
  GoogleGenAI,
  Type,
  createPartFromBase64,
  createPartFromUri,
  type GenerateContentConfig,
  type GenerateContentResponse,
  type Part,
  type Schema,
} from "@google/genai";
import {
  DOCUMENT_TYPES,
  ExtractionSchemaError,
  NON_ASSET_CODE,
  checkConsistency,
  normalizeExtraction,
  type ConsistencyCheck,
  type ExtractedInvoice,
} from "@/lib/invoice-normalization";

export { NON_ASSET_CODE, checkConsistency, normalizeExtraction };
export type { ConsistencyCheck, ExtractedInvoice };

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

export const SUPPORTED_INVOICE_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;
export type SupportedInvoiceMimeType = (typeof SUPPORTED_INVOICE_MIME_TYPES)[number];

/** Inline payload limit before switching to the Files API (base64 adds ~33 %). */
const INLINE_LIMIT_BYTES = 14 * 1024 * 1024;
/** Files API hard limit for a single document. */
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_ATTEMPTS = 3;

export interface ExtractionCategory {
  code: string;
  name: string;
  description?: string | null;
  assetAccount?: string | null;
}

export interface ExtractInvoiceOptions {
  data: Uint8Array;
  mimeType: string;
  fileName?: string;
  categories: ExtractionCategory[];
  companyName?: string;
  /** Unit value (HT) under which a durable good is expensed instead of capitalised. */
  capitalizationThreshold?: number;
  defaultCurrency?: string;
  signal?: AbortSignal;
  apiKey?: string;
  model?: string;
}

export interface ExtractionUsage {
  promptTokens: number | null;
  outputTokens: number | null;
  thoughtsTokens: number | null;
  totalTokens: number | null;
}

export interface ExtractionResult {
  data: ExtractedInvoice;
  consistency: ConsistencyCheck[];
  model: string;
  durationMs: number;
  attempts: number;
  ingestion: "inline" | "files-api";
  usage: ExtractionUsage;
}

export type ExtractionErrorCode =
  | "CONFIG"
  | "UNSUPPORTED_FILE"
  | "FILE_TOO_LARGE"
  | "RATE_LIMIT"
  | "API"
  | "TIMEOUT"
  | "ABORTED"
  | "BLOCKED"
  | "TRUNCATED"
  | "EMPTY_RESPONSE"
  | "INVALID_JSON"
  | "SCHEMA";

export class InvoiceExtractionError extends Error {
  readonly code: ExtractionErrorCode;
  readonly retryable: boolean;
  readonly httpStatus: number;

  constructor(message: string, code: ExtractionErrorCode, retryable = false, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "InvoiceExtractionError";
    this.code = code;
    this.retryable = retryable;
    this.httpStatus =
      code === "CONFIG"
        ? 503
        : code === "UNSUPPORTED_FILE"
          ? 415
          : code === "FILE_TOO_LARGE"
            ? 413
            : code === "RATE_LIMIT"
              ? 429
              : code === "TIMEOUT"
                ? 504
                : code === "BLOCKED" || code === "SCHEMA" || code === "TRUNCATED"
                  ? 422
                  : 502;
  }
}

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

// ---------------------------------------------------------------------------
// Response schema (OpenAPI subset understood by Gemini structured output)
// ---------------------------------------------------------------------------

const str = (description: string, nullable = true): Schema => ({ type: Type.STRING, nullable, description });
const num = (description: string, nullable = true): Schema => ({ type: Type.NUMBER, nullable, description });

export function buildInvoiceResponseSchema(categoryCodes: string[]): Schema {
  const categoryEnum = [...new Set([...categoryCodes.map((c) => c.toUpperCase()), NON_ASSET_CODE])];

  const line: Schema = {
    type: Type.OBJECT,
    description: "Une ligne de détail de la facture (un article ou une prestation).",
    properties: {
      designation: str("Désignation de l'article telle qu'imprimée, sans le numéro de série.", false),
      specifications: str("Caractéristiques techniques (processeur, RAM, dimensions, puissance…)."),
      brand: str("Marque / fabricant."),
      model: str("Modèle / référence fabricant."),
      serialNumbers: {
        type: Type.ARRAY,
        description: "Tous les numéros de série / IMEI / n° de châssis listés pour cette ligne, un par élément. Tableau vide si aucun.",
        items: { type: Type.STRING },
      },
      quantity: num("Quantité facturée.", false),
      unitPriceHT: num("Prix unitaire hors taxes, net de la remise de ligne."),
      vatRate: num("Taux de TVA en pourcentage (20, 14, 10, 7 ou 0)."),
      totalHT: num("Montant total HT de la ligne."),
      isFixedAsset: {
        type: Type.BOOLEAN,
        description: "true si le bien est une immobilisation corporelle/incorporelle durable ; false pour consommables, services, frais.",
      },
      assetCategoryCode: {
        type: Type.STRING,
        format: "enum",
        enum: categoryEnum,
        description: `Code de catégorie comptable. ${NON_ASSET_CODE} pour une charge (consommable, service, frais).`,
      },
      classificationRationale: str("Justification courte (≤ 20 mots) de la classification.", false),
      confidence: num("Confiance de l'extraction de cette ligne entre 0 et 1.", false),
    },
    required: [
      "designation",
      "specifications",
      "brand",
      "model",
      "serialNumbers",
      "quantity",
      "unitPriceHT",
      "vatRate",
      "totalHT",
      "isFixedAsset",
      "assetCategoryCode",
      "classificationRationale",
      "confidence",
    ],
    propertyOrdering: [
      "designation",
      "specifications",
      "brand",
      "model",
      "serialNumbers",
      "quantity",
      "unitPriceHT",
      "vatRate",
      "totalHT",
      "isFixedAsset",
      "assetCategoryCode",
      "classificationRationale",
      "confidence",
    ],
  };

  return {
    type: Type.OBJECT,
    properties: {
      documentType: {
        type: Type.STRING,
        format: "enum",
        enum: [...DOCUMENT_TYPES],
        description: "Nature du document.",
      },
      supplier: {
        type: Type.OBJECT,
        properties: {
          name: str("Raison sociale du fournisseur (émetteur de la facture, pas le client)."),
          ice: str("ICE du fournisseur : Identifiant Commun de l'Entreprise, 15 chiffres."),
          taxId: str("Identifiant fiscal (IF) du fournisseur."),
          tradeRegister: str("Numéro de Registre de Commerce (RC)."),
          address: str("Adresse du fournisseur."),
          email: str("E-mail du fournisseur."),
          phone: str("Téléphone du fournisseur."),
        },
        required: ["name", "ice", "taxId", "tradeRegister", "address", "email", "phone"],
        propertyOrdering: ["name", "ice", "taxId", "tradeRegister", "address", "email", "phone"],
      },
      invoice: {
        type: Type.OBJECT,
        properties: {
          number: str("Numéro de la facture."),
          date: str("Date de facture au format AAAA-MM-JJ."),
          dueDate: str("Date d'échéance au format AAAA-MM-JJ."),
          currency: str("Code devise ISO 4217 (MAD, EUR, USD…).", false),
          totalHT: num("Total hors taxes de la facture."),
          totalVAT: num("Montant total de la TVA."),
          totalTTC: num("Total toutes taxes comprises (net à payer avant retenues)."),
        },
        required: ["number", "date", "dueDate", "currency", "totalHT", "totalVAT", "totalTTC"],
        propertyOrdering: ["number", "date", "dueDate", "currency", "totalHT", "totalVAT", "totalTTC"],
      },
      lines: { type: Type.ARRAY, items: line, description: "Toutes les lignes de détail, dans l'ordre du document." },
      warnings: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "Anomalies constatées : zones illisibles, remise globale, document partiel, totaux incohérents…",
      },
      overallConfidence: num("Confiance globale de l'extraction entre 0 et 1.", false),
    },
    required: ["documentType", "supplier", "invoice", "lines", "warnings", "overallConfidence"],
    propertyOrdering: ["documentType", "supplier", "invoice", "lines", "warnings", "overallConfidence"],
  };
}

// ---------------------------------------------------------------------------
// Prompting
// ---------------------------------------------------------------------------

export function buildSystemInstruction(opts: Pick<ExtractInvoiceOptions, "categories" | "capitalizationThreshold" | "defaultCurrency" | "companyName">): string {
  const threshold = opts.capitalizationThreshold ?? 0;
  const categoryTable = opts.categories
    .map((c) => `- ${c.code.toUpperCase()} : ${c.name}${c.assetAccount ? ` (compte ${c.assetAccount})` : ""}${c.description ? ` — ${c.description}` : ""}`)
    .join("\n");
  return [
    "Tu es un expert-comptable marocain spécialisé dans la gestion des immobilisations (CGNC) et un moteur d'extraction de données de factures fournisseurs.",
    `Le client destinataire des factures est ${opts.companyName ?? "l'entreprise"} : ne confonds jamais ses identifiants (ICE, IF, adresse) avec ceux du fournisseur émetteur.`,
    "",
    "RÈGLES D'EXTRACTION",
    "1. Extrais uniquement ce qui est imprimé sur le document. N'invente aucune valeur : utilise null si une information est absente ou illisible.",
    "2. Dates au format AAAA-MM-JJ. Les dates imprimées sont au format européen (JJ/MM/AAAA).",
    "3. Nombres décimaux JSON sans séparateur de milliers : « 12 500,00 DH » → 12500.00.",
    `4. Devise ISO 4217 : « DH », « Dhs », « MAD » → MAD ; « € » → EUR. Par défaut : ${opts.defaultCurrency ?? "MAD"}.`,
    "5. ICE = 15 chiffres. IF, RC, Patente et CNSS sont des identifiants distincts.",
    "6. Une entrée dans `lines` par ligne de détail. Ignore les lignes de sous-total, total, report et les mentions légales. Une remise globale doit être signalée dans `warnings`.",
    "7. `unitPriceHT` est net de la remise de ligne ; `totalHT` = montant HT de la ligne. Si la facture est en TTC uniquement, déduis le HT avec le taux de TVA et signale-le dans `warnings`.",
    "8. Liste chaque numéro de série / IMEI / n° de châssis séparément dans `serialNumbers`, et retire-les de la désignation.",
    "",
    "RÈGLES DE CLASSIFICATION (immobilisation vs charge)",
    "- Immobilisation (isFixedAsset = true) : bien durable, identifiable, destiné à être utilisé plus d'un exercice (ordinateur, écran, serveur, imprimante, mobilier, véhicule, machine, outillage durable, climatiseur, aménagement, logiciel acquis en licence perpétuelle).",
    "- Charge (isFixedAsset = false, assetCategoryCode = " + NON_ASSET_CODE + ") : consommables (papier, toner, cartouches, câbles et petites fournitures), services (installation, maintenance, formation, abonnement, SaaS, transport, livraison), frais divers.",
    threshold > 0
      ? `- Seuil d'immobilisation de l'entreprise : ${threshold} ${opts.defaultCurrency ?? "MAD"} HT par unité. Un bien durable sous ce seuil reste isFixedAsset = true mais signale-le dans classificationRationale.`
      : "- Aucun seuil minimal d'immobilisation n'est défini.",
    "- Choisis la catégorie la plus spécifique parmi :",
    categoryTable,
    "",
    "Renseigne `confidence` et `overallConfidence` honnêtement (0 = illisible, 1 = certain).",
  ].join("\n");
}

function buildUserPrompt(fileName?: string): string {
  return [
    `Analyse le document joint${fileName ? ` (« ${fileName} »)` : ""}.`,
    "Extrais l'en-tête de la facture, le fournisseur et toutes les lignes de détail selon le schéma JSON imposé,",
    "puis classe chaque ligne (immobilisation ou charge) avec sa catégorie comptable.",
  ].join(" ");
}

// ---------------------------------------------------------------------------
// Transport helpers
// ---------------------------------------------------------------------------

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new InvoiceExtractionError("Extraction annulée.", "ABORTED"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new InvoiceExtractionError("Extraction annulée.", "ABORTED"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function mapError(error: unknown, signal?: AbortSignal): InvoiceExtractionError {
  if (error instanceof InvoiceExtractionError) return error;
  if (error instanceof ExtractionSchemaError) {
    return new InvoiceExtractionError(error.message, "SCHEMA", true, { cause: error });
  }
  if (signal?.aborted) return new InvoiceExtractionError("Extraction annulée.", "ABORTED", false, { cause: error });
  if (error instanceof ApiError) {
    const status = error.status;
    if (status === 429) {
      return new InvoiceExtractionError("Quota de l'API Gemini atteint. Nouvelle tentative recommandée dans une minute.", "RATE_LIMIT", true, { cause: error });
    }
    if (status === 401 || status === 403) {
      return new InvoiceExtractionError("Clé API Gemini invalide ou non autorisée (GEMINI_API_KEY).", "CONFIG", false, { cause: error });
    }
    if (status === 404) {
      return new InvoiceExtractionError("Modèle Gemini introuvable : vérifiez GEMINI_MODEL.", "CONFIG", false, { cause: error });
    }
    if (status === 408 || status === 504) {
      return new InvoiceExtractionError("Délai dépassé lors de l'appel à Gemini.", "TIMEOUT", true, { cause: error });
    }
    if (status >= 500) {
      return new InvoiceExtractionError(`Service Gemini indisponible (HTTP ${status}).`, "API", true, { cause: error });
    }
    return new InvoiceExtractionError(`Requête refusée par Gemini (HTTP ${status}) : ${error.message}`, "API", false, { cause: error });
  }
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Error && (error.name === "AbortError" || /timed? ?out|timeout/i.test(message))) {
    return new InvoiceExtractionError("Délai dépassé lors de l'appel à Gemini.", "TIMEOUT", true, { cause: error });
  }
  if (/fetch failed|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|network/i.test(message)) {
    return new InvoiceExtractionError("Impossible de joindre l'API Gemini (réseau).", "API", true, { cause: error });
  }
  return new InvoiceExtractionError(`Erreur inattendue pendant l'extraction : ${message}`, "API", false, { cause: error });
}

async function withRetry<T>(fn: (attempt: number) => Promise<T>, signal?: AbortSignal): Promise<{ value: T; attempts: number }> {
  let lastError: InvoiceExtractionError | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return { value: await fn(attempt), attempts: attempt };
    } catch (error) {
      lastError = mapError(error, signal);
      if (!lastError.retryable || attempt === MAX_ATTEMPTS) throw lastError;
      const base = lastError.code === "RATE_LIMIT" ? 5000 : 1200;
      const delay = Math.min(30_000, base * 2 ** (attempt - 1)) + Math.floor(Math.random() * 500);
      await sleep(delay, signal);
    }
  }
  throw lastError ?? new InvoiceExtractionError("Extraction impossible.", "API");
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : trimmed;
}

function extractText(response: GenerateContentResponse): string {
  const blockReason = response.promptFeedback?.blockReason;
  if (blockReason) {
    throw new InvoiceExtractionError(`Document bloqué par les filtres de sécurité Gemini (${blockReason}).`, "BLOCKED");
  }
  const finish = String(response.candidates?.[0]?.finishReason ?? "");
  if (finish === "MAX_TOKENS") {
    throw new InvoiceExtractionError(
      "Réponse tronquée : la facture comporte trop de lignes pour une seule extraction. Scindez le document (par pages) et réessayez.",
      "TRUNCATED",
    );
  }
  if (["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY"].includes(finish)) {
    throw new InvoiceExtractionError(`Réponse interrompue par Gemini (${finish}).`, "BLOCKED");
  }
  const text = response.text;
  if (!text || !text.trim()) throw new InvoiceExtractionError("Réponse vide de Gemini.", "EMPTY_RESPONSE", true);
  return text;
}

async function uploadViaFilesApi(
  ai: GoogleGenAI,
  data: Uint8Array,
  mimeType: string,
  displayName: string,
  signal?: AbortSignal,
): Promise<{ name: string; uri: string; mimeType: string }> {
  const blob = new Blob([new Uint8Array(data)], { type: mimeType });
  let file = await ai.files.upload({ file: blob, config: { mimeType, displayName } });
  const deadline = Date.now() + 120_000;
  while (file.state === FileState.PROCESSING) {
    if (Date.now() > deadline) {
      throw new InvoiceExtractionError("Le traitement du fichier par Gemini dépasse 2 minutes.", "TIMEOUT", true);
    }
    await sleep(1500, signal);
    file = await ai.files.get({ name: file.name! });
  }
  if (file.state === FileState.FAILED || !file.uri || !file.name) {
    throw new InvoiceExtractionError("Gemini n'a pas pu traiter le fichier déposé.", "API");
  }
  return { name: file.name, uri: file.uri, mimeType: file.mimeType ?? mimeType };
}

function generationConfig(opts: ExtractInvoiceOptions, schema: Schema): GenerateContentConfig {
  const thinkingBudget = Number.parseInt(process.env.GEMINI_THINKING_BUDGET ?? "1024", 10);
  const timeout = Number.parseInt(process.env.GEMINI_TIMEOUT_MS ?? "120000", 10);
  return {
    systemInstruction: buildSystemInstruction(opts),
    responseMimeType: "application/json",
    responseSchema: schema,
    temperature: 0,
    topP: 0.95,
    maxOutputTokens: 32_768,
    thinkingConfig: Number.isFinite(thinkingBudget) ? { thinkingBudget } : undefined,
    httpOptions: { timeout: Number.isFinite(timeout) ? timeout : 120_000 },
    abortSignal: opts.signal,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function extractInvoice(opts: ExtractInvoiceOptions): Promise<ExtractionResult> {
  const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new InvoiceExtractionError("L'extraction IA n'est pas configurée : renseignez GEMINI_API_KEY.", "CONFIG");
  }
  if (!SUPPORTED_INVOICE_MIME_TYPES.includes(opts.mimeType as SupportedInvoiceMimeType)) {
    throw new InvoiceExtractionError(`Format non supporté (${opts.mimeType}). Formats acceptés : PDF, JPG, PNG, WebP, HEIC.`, "UNSUPPORTED_FILE");
  }
  if (opts.data.byteLength === 0) throw new InvoiceExtractionError("Le fichier est vide.", "UNSUPPORTED_FILE");
  if (opts.data.byteLength > MAX_FILE_BYTES) {
    throw new InvoiceExtractionError("Fichier trop volumineux pour l'extraction (50 Mo maximum).", "FILE_TOO_LARGE");
  }
  if (opts.categories.length === 0) {
    throw new InvoiceExtractionError("Aucune catégorie comptable active n'est définie pour la classification.", "CONFIG");
  }

  const model = opts.model ?? process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;
  const ai = new GoogleGenAI({ apiKey });
  const categoryCodes = opts.categories.map((c) => c.code.toUpperCase());
  const schema = buildInvoiceResponseSchema(categoryCodes);
  const config = generationConfig(opts, schema);
  const started = Date.now();
  const ingestion: ExtractionResult["ingestion"] = opts.data.byteLength <= INLINE_LIMIT_BYTES ? "inline" : "files-api";
  let uploadedName: string | null = null;

  try {
    let filePart: Part;
    if (ingestion === "inline") {
      filePart = createPartFromBase64(Buffer.from(opts.data).toString("base64"), opts.mimeType);
    } else {
      const uploaded = await withRetry(
        () => uploadViaFilesApi(ai, opts.data, opts.mimeType, opts.fileName ?? "facture", opts.signal),
        opts.signal,
      );
      uploadedName = uploaded.value.name;
      filePart = createPartFromUri(uploaded.value.uri, uploaded.value.mimeType);
    }

    const { value, attempts } = await withRetry(async () => {
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [filePart, { text: buildUserPrompt(opts.fileName) }] }],
        config,
      });
      const text = extractText(response);
      let raw: unknown;
      try {
        raw = JSON.parse(stripCodeFences(text));
      } catch (error) {
        throw new InvoiceExtractionError("Gemini a renvoyé un JSON invalide.", "INVALID_JSON", true, { cause: error });
      }
      const data = normalizeExtraction(raw, {
        categoryCodes,
        capitalizationThreshold: opts.capitalizationThreshold,
        defaultCurrency: opts.defaultCurrency,
      });
      return { data, usage: response.usageMetadata };
    }, opts.signal);

    const { data, usage } = value;
    return {
      data,
      consistency: checkConsistency({
        totalHT: data.invoice.totalHT,
        totalVAT: data.invoice.totalVAT,
        totalTTC: data.invoice.totalTTC,
        lines: data.lines,
      }),
      model,
      durationMs: Date.now() - started,
      attempts,
      ingestion,
      usage: {
        promptTokens: usage?.promptTokenCount ?? null,
        outputTokens: usage?.candidatesTokenCount ?? null,
        thoughtsTokens: usage?.thoughtsTokenCount ?? null,
        totalTokens: usage?.totalTokenCount ?? null,
      },
    };
  } finally {
    if (uploadedName) {
      await ai.files.delete({ name: uploadedName }).catch(() => undefined);
    }
  }
}
