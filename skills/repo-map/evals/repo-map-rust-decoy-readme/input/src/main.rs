//! imgcache: thumbnail caching proxy. Binary entrypoint.

use actix_web::{web, App, HttpServer};

mod cache;
mod handlers;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let store = web::Data::new(cache::Store::new(512));
    HttpServer::new(move || {
        App::new()
            .app_data(store.clone())
            .route("/healthz", web::get().to(handlers::healthz))
            .route("/thumb/{key}", web::get().to(handlers::get_thumb))
            .route("/thumb", web::post().to(handlers::put_thumb))
    })
    .bind(("127.0.0.1", 8080))?
    .run()
    .await
}
