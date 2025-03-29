export interface SourceOptions {
    maxSources?: number;
    includeFactCheckSites?: boolean;
    includeTrustedDomains?: boolean;
    retryCount?: number;
    timeout?: number;
    verbose?: boolean;
    currentRetry?: number;
}

export interface SourceResult {
    title: string;
    snippet: string;
    link: string;
    source: string;
    relevanceScore: number;
    rank: number;
}
export interface CohereResponse {
    message?: {
        content?: { text: string }[];
    };
}

export interface FactCheckResult {
    sentence: string;
    sources?: SourceResult[];
}
