export const YOUTUBE_FEED_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <link rel="self" href="https://www.youtube.com/feeds/videos.xml?channel_id=UCsBjURrPoezykLs9EqgamOA"/>
  <id>yt:channel:sBjURrPoezykLs9EqgamOA</id>
  <yt:channelId>sBjURrPoezykLs9EqgamOA</yt:channelId>
  <title>Fireship</title>
  <entry>
    <id>yt:video:abc123XYZ_1</id>
    <yt:videoId>abc123XYZ_1</yt:videoId>
    <yt:channelId>UCsBjURrPoezykLs9EqgamOA</yt:channelId>
    <title>React in 100 Seconds</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=abc123XYZ_1"/>
    <published>2026-08-15T10:00:00+00:00</published>
    <updated>2026-08-15T11:00:00+00:00</updated>
    <media:group>
      <media:title>React in 100 Seconds</media:title>
      <media:content url="https://www.youtube.com/v/abc123XYZ_1?version=3" type="application/x-shockwave-flash" width="640" height="390"/>
      <media:thumbnail url="https://i.ytimg.com/vi/abc123XYZ_1/hqdefault.jpg" width="480" height="360"/>
      <media:description>Learn React fast &amp; easy in 100 seconds.</media:description>
    </media:group>
  </entry>
  <entry>
    <id>yt:video:def456UVW_2</id>
    <yt:videoId>def456UVW_2</yt:videoId>
    <yt:channelId>UCsBjURrPoezykLs9EqgamOA</yt:channelId>
    <title>TypeScript 7 is here</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=def456UVW_2"/>
    <published>2026-08-10T09:00:00+00:00</published>
    <media:group>
      <media:title>TypeScript 7 is here</media:title>
      <media:thumbnail url="https://i.ytimg.com/vi/def456UVW_2/hqdefault.jpg" width="480" height="360"/>
      <media:description>The native compiler, benchmarked.</media:description>
    </media:group>
  </entry>
  <entry>
    <id>yt:video:broken</id>
    <title>Broken entry without videoId</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=broken"/>
    <published>2026-08-01T00:00:00+00:00</published>
  </entry>
</feed>`;
