//! Bounded in-memory thumbnail store keyed by content hash.

use std::collections::HashMap;
use std::sync::Mutex;

use sha2::{Digest, Sha256};

pub struct Store {
    capacity: usize,
    entries: Mutex<HashMap<String, Vec<u8>>>,
}

impl Store {
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity,
            entries: Mutex::new(HashMap::new()),
        }
    }

    pub fn put(&self, bytes: Vec<u8>) -> String {
        let key = hex(&Sha256::digest(&bytes));
        let mut entries = self.entries.lock().unwrap();
        if entries.len() >= self.capacity {
            if let Some(evict) = entries.keys().next().cloned() {
                entries.remove(&evict);
            }
        }
        entries.insert(key.clone(), bytes);
        key
    }

    pub fn get(&self, key: &str) -> Option<Vec<u8>> {
        self.entries.lock().unwrap().get(key).cloned()
    }
}

fn hex(digest: &[u8]) -> String {
    digest.iter().map(|b| format!("{b:02x}")).collect()
}
