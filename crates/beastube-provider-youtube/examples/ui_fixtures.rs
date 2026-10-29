//! Dumps the data every screen is drawn from, as one JSON document.
//!
//! ```text
//! cargo run -p beastube-provider-youtube --example ui_fixtures > fixtures.json
//! ```
//!
//! The interface runs in a plain browser behind its IPC mock, which is the only way to look at a
//! screen without the desktop shell — and a screen laid out against invented data is laid out
//! against data the provider never sends. This is the real thing for each surface: the home feed,
//! search, a watch page with its related list and the cues of its caption tracks (parsed by the
//! same code the application uses), a channel, and the Shorts feed.

use beastube_core::ids::{ChannelId, VideoId};
use beastube_core::model::channel::ChannelTab;
use beastube_core::model::search::SearchFilters;
use beastube_provider::traits::{ChannelProvider, MetadataProvider, SearchProvider, VideoProvider};
use beastube_provider_youtube::YouTubeProvider;
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

/// The watch page's video: lyrics captioned by hand, plus an auto-generated track.
const WATCH: &str = "dQw4w9WgXcQ";
const QUERY: &str = "lofi hip hop";
const CHANNEL: &str = "UCX6OQ3DkcsbYNE6H8uQQuVA";

fn value<T: serde::Serialize>(result: Result<T, impl std::fmt::Display>, what: &str) -> Value {
    match result {
        Ok(found) => serde_json::to_value(found).expect("serialisable"),
        Err(error) => {
            eprintln!("{what}: {error}");
            Value::Null
        }
    }
}

#[tokio::main(flavor = "multi_thread")]
async fn main() {
    let cache = tempfile::tempdir().expect("a cache directory");
    let provider = YouTubeProvider::new(cache.path()).expect("a provider");
    let cancel = CancellationToken::new();
    let id = VideoId::new(WATCH.to_owned()).expect("a video id");
    let channel = ChannelId::new(CHANNEL).expect("a channel id");

    let video = provider.video(&id, &cancel).await;
    let mut cues = serde_json::Map::new();
    if let Ok(details) = &video {
        for track in details.captions.iter().take(4) {
            let parsed = provider.caption_cues(&track.url, &cancel).await;
            cues.insert(track.url.clone(), value(parsed, "caption cues"));
        }
    }

    let fixtures = json!({
        "feed": value(provider.discovery_feed(None, &cancel).await, "discovery feed"),
        "search": value(
            provider.search(QUERY, &SearchFilters::default(), None, &cancel).await,
            "search",
        ),
        "video": value(video, "video"),
        "related": value(provider.related(&id, &cancel).await, "related"),
        "cues": Value::Object(cues),
        "channel": value(provider.channel(&channel, &cancel).await, "channel"),
        "channelVideos": value(
            provider.channel_content(&channel, ChannelTab::Videos, None, &cancel).await,
            "channel videos",
        ),
        "shorts": value(provider.search_shorts("#shorts", &cancel).await, "shorts"),
    });
    println!("{}", serde_json::to_string(&fixtures).expect("serialisable"));
}
