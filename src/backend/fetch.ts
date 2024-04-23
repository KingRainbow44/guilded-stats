import { invoke } from "@tauri-apps/api";

export type RequestOptions = {
    method: "GET" | "POST" | "PUT" | "DELETE";
    headers?: Record<string, string>;
    body?: string;
};

export type HttpResponse = {
    success: boolean;
    status: number;
    body: string;
    headers: Record<string, string>;
};

/**
 * Fetches a URL and returns the response.
 *
 * @param url The URL to fetch.
 * @param options The request options.
 */
export default async function fetch(
    url: string,
    options?: RequestOptions
): Promise<HttpResponse> {
    const response = await invoke("fetch", {
        request: {
            url,
            headers: options?.headers,
            method: options?.method ?? "GET",
            body: options?.body
        }
    }) as HttpResponse;

    if (!response.success) {
        throw new Error("Unable to complete HTTP request.");
    }

    return response;
}
