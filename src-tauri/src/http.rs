use std::collections::HashMap;
use std::str::FromStr;
use reqwest::{Client, Method};
use reqwest::redirect::Policy;
use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize)]
pub struct HttpRequest {
    url: String,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    method: String,
}

#[derive(Clone, Serialize)]
pub struct HttpResponse {
    success: bool,
    status: u16,
    body: String,
    headers: HashMap<String, String>
}

#[tauri::command]
pub async fn fetch(request: HttpRequest) -> Result<HttpResponse, &'static str> {
    let client = Client::builder()
        .redirect(Policy::limited(15))
        .danger_accept_invalid_certs(true)
        .build();

    if client.is_err() {
        return Err("Failed to create HTTP client.");
    }
    let client = client.unwrap();

    let request_method = Method::from_str(&*request.method);
    if request_method.is_err() {
        return Err("Invalid HTTP method.");
    }
    let request_method = request_method.unwrap();

    let mut builder = client.request(
        request_method, request.url);

    // Add all headers.
    if let Some(headers) = request.headers {
        for (key, value) in headers {
            builder = builder.header(key, value);
        }
    }

    // Set the body if it exists.
    if let Some(body) = request.body {
        builder = builder.body(body);
    }

    let response = builder.send().await;
    if response.is_err() {
        return Err("Failed to send HTTP request.");
    }
    let response = response.unwrap();

    Ok(HttpResponse {
        success: true,
        status: u16::from(response.status()),
        headers: response.headers().iter().map(|(key, value)| {
            (key.as_str().to_string(), value.to_str().unwrap().to_string())
        }).collect(),
        body: response.text().await.unwrap()
    })
}
