//! Measures how long the home screen's ingredients take, each on its own and together.
//!
//! ```text
//! cargo run -p beastube-provider-youtube --example feed_timing
//! ```
//!
//! "Make it faster" needs a number to start from. This prints wall time for the pieces the home
//! feed is assembled from — the related list behind each seed, the category hubs, and the watch
//! page for a handful of ids — so a change can be judged against what it replaced rather than
//! against how it felt.

use std::time::Instant;

use beastube_core::ids::VideoId;
use beastube_provider::traits::{MetadataProvider, VideoProvider};
use beastube_provider_youtube::YouTubeProvider;
use tokio_util::sync::CancellationToken;

/// Seeds standing in for a watch history: four unrelated, well-known videos.
const SEEDS: &[&str] = &["dQw4w9WgXcQ", "9bZkp7q19f0", "kJQP7kiw5Fk", "jNQXAC9IVRw"];

/// Videos to open, including ones whose watch page the typed parser refuses.
const WATCH: &[&str] = &["dQw4w9WgXcQ", "Kk20GpCX4-Y", "sOzbDDXDs1o", "LlAyUk-NnUw"];

fn ms(started: Instant) -> u128 {
    started.elapsed().as_millis()
}

#[tokio::main(flavor = "multi_thread")]
async fn main() {
    let cache = tempfile::tempdir().expect("a cache directory");
    let provider = YouTubeProvider::new(cache.path()).expect("a provider");
    let cancel = CancellationToken::new();
    provider.warm().await;

    let started = Instant::now();
    let lists = futures::future::join_all(SEEDS.iter().map(|seed| {
        let id = VideoId::new((*seed).to_owned()).expect("a valid id");
        let provider = &provider;
        let cancel = &cancel;
        async move {
            let began = Instant::now();
            let count = provider
                .related(&id, cancel)
                .await
                .map_or(0, |page| page.items.len());
            (id, count, ms(began))
        }
    }))
    .await;
    println!("related lists, {} seeds concurrently: {} ms", SEEDS.len(), ms(started));
    for (id, count, took) in lists {
        println!("    {:<12} {count:>3} videos  {took:>5} ms", id.as_str());
    }

    let started = Instant::now();
    let hubs = provider.discovery_feed(None, &cancel).await;
    println!(
        "\ncategory hubs together: {} ms, {} items",
        ms(started),
        hubs.map_or(0, |page| page.items.len())
    );

    println!("\nwatch page, one id at a time:");
    for id in WATCH {
        let id = VideoId::new((*id).to_owned()).expect("a valid id");
        let began = Instant::now();
        let outcome = match provider.video(&id, &cancel).await {
            Ok(details) => format!(
                "ok   likes {:<9} subscribers {:<10} captions {}",
                details
                    .like_count
                    .map_or_else(|| "-".to_owned(), |n| n.to_string()),
                details
                    .channel_subscriber_count
                    .map_or_else(|| "-".to_owned(), |n| n.to_string()),
                details.captions.len()
            ),
            Err(error) => format!("FAILED {error}"),
        };
        println!("    {:<12} {:>5} ms  {outcome}", id.as_str(), ms(began));
    }
}
