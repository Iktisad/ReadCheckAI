// ✅ server.ts (Express API with robust JSON extraction from Cohere response + sources)

import express, { Application, NextFunction, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import logger from "./logger.ts";
dotenv.config();

const app :Application = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());
app.use((req:Request, res:Response, next: NextFunction) => {
  logger.info(`${req.method} ${req.url}`);
  next();
});


// Helper: Extract JSON from mixed response text
function extractJsonFromText(text: string): any[] {
  try {
    text = text.trim().replace(/^```json|```$/g, "");

    const start = text.indexOf("[");
    const end = text.lastIndexOf("]") + 1;

    if (start === -1 || end === -1 || start >= end) {
      throw new Error("Valid JSON array not found.");
    }

    const jsonChunk = text.slice(start, end);
    return JSON.parse(jsonChunk);
  } catch (err: any) {
    console.error("❌ Failed to extract JSON:", err.message);
    return [];
  }
}

interface SourceOptions {
  maxSources?: number;
  includeFactCheckSites?: boolean;
  includeTrustedDomains?: boolean;
  retryCount?: number;
  timeout?: number;
  verbose?: boolean;
  currentRetry?: number;
}

interface SourceResult {
  title: string;
  snippet: string;
  link: string;
  source: string;
  relevanceScore: number;
  rank: number;
}
interface CohereResponse {
  message?: {
    content?: { text: string }[];
  };
}
/**
 * Fetches and validates fact-checking sources for a claim
 */
async function fetchSources(claim: string, options: SourceOptions = {}): Promise<SourceResult[]> {
  const config = {
    maxSources: options.maxSources || 5,
    includeFactCheckSites: options.includeFactCheckSites !== false,
    includeTrustedDomains: options.includeTrustedDomains !== false,
    retryCount: options.retryCount || 1,
    timeout: options.timeout || 8000,
    verbose: options.verbose || false,
  };

  const trustedFactCheckDomains = [
    "factcheck.org",
    "politifact.com",
    "snopes.com",
    "reuters.com/fact-check",
    "apnews.com/hub/fact-checking",
    "bbc.com/news/reality_check",
    "fullfact.org",
    "factcheck.afp.com",
    "usatoday.com/fact-check",
    "washingtonpost.com/fact-checker",
  ];

  const cleanedClaim = claim.replace(/[^\w\s]/gi, " ").trim();

  try {
    console.log(`🔎 Searching for sources on: "${cleanedClaim}"`);

    const searchQueries = [{ q: cleanedClaim, label: "General" }];

    if (config.includeFactCheckSites) {
      searchQueries.push({ q: `Fact check: ${cleanedClaim}`, label: "Fact Check" });
    }

    let allResults: any[] = [];

    for (const queryObj of searchQueries) {
      try {
        const response = await axios.get("https://serpapi.com/search.json", {
          params: {
            q: queryObj.q,
            api_key: process.env.SERP_API_KEY,
            num: config.maxSources * 2,
            hl: "en",
            gl: "us",
          },
          timeout: config.timeout,
        });

        const results = (response.data.organic_results || []).map((r: any) => ({
          ...r,
          queryType: queryObj.label,
        }));

        allResults = [...allResults, ...results];

        if (config.verbose) {
          console.log(`📊 Found ${results.length} results for "${queryObj.label}" query`);
        }
      } catch (innerErr: any) {
        console.error(`Error with "${queryObj.label}" search:`, innerErr.message);
      }
    }

    const processedResults: SourceResult[] = allResults
      .filter((r) => r.title && r.link)
      .map((r) => {
        let score = 0;

        if (config.includeTrustedDomains && trustedFactCheckDomains.some((domain) => r.link.includes(domain))) {
          score += 10;
        }

        if (r.queryType === "Fact Check") {
          score += 5;
        }

        const keywords = cleanedClaim
          .toLowerCase()
          .split(" ")
          .filter((word) => word.length > 3);

        keywords.forEach((keyword) => {
          if (r.title.toLowerCase().includes(keyword)) score += 1;
          if (r.snippet && r.snippet.toLowerCase().includes(keyword)) score += 0.5;
        });

        const factCheckTerms = ["fact check", "fact-check", "debunk", "verify", "false", "true"];
        factCheckTerms.forEach((term) => {
          if (r.title.toLowerCase().includes(term)) score += 2;
          if (r.snippet && r.snippet.toLowerCase().includes(term)) score += 1;
        });

        return {
          title: r.title,
          snippet: r.snippet || "",
          link: r.link,
          source: new URL(r.link).hostname.replace("www.", ""),
          relevanceScore: score,
          rank: 0, // placeholder for now
        };
      })
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, config.maxSources)
      .map((r, index) => ({ ...r, rank: index + 1 }));

    console.log(`✅ Successfully found ${processedResults.length} relevant sources`);
    return processedResults;
  } catch (err: any) {
    console.error("❌ Source fetch error:", err.message);

    if (options.currentRetry && options.currentRetry < config.retryCount) {
      console.log(`🔄 Retrying source fetch (${options.currentRetry + 1}/${config.retryCount})...`);
      return fetchSources(claim, {
        ...options,
        currentRetry: (options.currentRetry || 0) + 1,
      });
    }

    return [];
  }
}

interface FactCheckResult {
  sentence: string;
  sources?: SourceResult[];
}

async function checkSentences(sentences: string): Promise<FactCheckResult[]> {
  if (!sentences || sentences.length === 0) {
    console.log("No sentences to check");
    return [];
  }

  const systemPrompt = `
  You are a specialized fact-checking assistant designed to identify inaccuracies in articles.
  
  Instructions:
  1. Analyze the provided article to identify factual claims.
  2. Evaluate each claim for accuracy using your knowledge.
  3. Extract ONLY statements that contain inaccurate or unfactual information.
  4. For each inaccurate claim, include the exact verbatim text as it appears in the article.
  5. If no inaccurate claims are found, return an empty array.
  
  Response Format:
  Return ONLY a properly formatted JSON array with the following structure:
  [
    {
      "sentence": "The exact text of the inaccurate statement",
    },
    // Additional inaccurate statements if present
  ]
  
  Do not include any explanatory text, commentary, or any content other than the JSON array.
  `;


  // Create a more detailed prompt with specific instructions and examples
  const userPrompt = `
  Please analyze the following article for factual accuracy:
  
  ARTICLE TEXT:
  ${sentences}
  
  Identify and extract ONLY statements containing inaccurate or misleading information. Return your findings as a JSON array of inaccurate statements exactly as they appear in the text. If all statements are factually accurate, return an empty array.
  `;


  const response = await fetch("https://api.cohere.com/v2/chat", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + process.env.COHERE_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      stream: false,
      model: "command-r-plus-08-2024",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  const data = (await response.json()) as CohereResponse;
  const extractedText = data.message?.content?.[0]?.text || "";
  console.log("📩 Extracted JSON:\n", extractedText);

  try {
    const parsed: FactCheckResult[] = extractJsonFromText(extractedText);

    const results: FactCheckResult[] = [];
    for (const result of parsed) {
      console.log(`🔗 Fetching sources for inaccurate claim: "${result.sentence}"`);
      result.sources = await fetchSources(result.sentence);
      results.push(result);
    }

    return results;
  } catch (error) {
    console.error("Error processing AI response:", error);
    return [];
  }
}

// API route to process full article
app.post("/fact-check-article", async (req: Request, res: Response): Promise<void> => {
  const { article } = req.body;

  if (!article || article.length < 50) {
    logger.error("Invalid article input.");
    res.status(400).json({ error: "Invalid article input." });
    return;
  }

  try {
    const claims= await checkSentences(article);
    logger.info(`❌ Found ${claims.length} inaccurate claim(s).`);
    res.status(200).json({ claims });
  } catch (error) {
    logger.error("Fact-check article error:", error);
     res.status(500).json({ error: "Something went wrong." });
  }
});

app.listen(PORT, () => {
  logger.info(`✅ Server running on http://localhost:${PORT}`);
});
