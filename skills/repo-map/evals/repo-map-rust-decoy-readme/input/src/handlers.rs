//! HTTP handlers for the thumbnail API.

use actix_web::{web, HttpResponse};
use serde::Serialize;

use crate::cache::Store;

#[derive(Serialize)]
struct PutResponse {
    key: String,
}

pub async fn healthz() -> HttpResponse {
    HttpResponse::Ok().body("ok")
}

pub async fn get_thumb(store: web::Data<Store>, key: web::Path<String>) -> HttpResponse {
    match store.get(&key) {
        Some(bytes) => HttpResponse::Ok().content_type("image/png").body(bytes),
        None => HttpResponse::NotFound().finish(),
    }
}

pub async fn put_thumb(store: web::Data<Store>, body: web::Bytes) -> HttpResponse {
    let key = store.put(body.to_vec());
    HttpResponse::Created().json(PutResponse { key })
}
