export const RSS2_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Example Tech</title>
    <link>https://example-tech.com</link>
    <description>Tech news</description>
    <item>
      <title><![CDATA[Breaking: AI & the <em>Future</em>]]></title>
      <link>https://example-tech.com/ai-future</link>
      <description><![CDATA[<p>Big news about "AI" today.</p> <a href="https://x">Read more</a>]]></description>
      <pubDate>Tue, 18 Aug 2026 08:30:00 GMT</pubDate>
      <media:thumbnail url="https://example-tech.com/img/ai.jpg" width="640" height="360"/>
      <category>ai</category>
    </item>
    <item>
      <title>Chips &amp; Salsa</title>
      <link>https://example-tech.com/chips</link>
      <description>Plain description with &#39;entities&#39; and &lt;markup&gt;</description>
      <enclosure url="https://example-tech.com/img/chips.png" type="image/png" length="1234"/>
      <pubDate>not a real date</pubDate>
    </item>
    <item>
      <title>Item without link</title>
      <description>This one has no link element and must be skipped.</description>
    </item>
  </channel>
</rss>`;

export const ATOM_FIXTURE = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Atom Blog</title>
  <id>tag:atom.example.com,2026:feed</id>
  <updated>2026-08-18T00:00:00Z</updated>
  <entry>
    <id>tag:atom.example.com,2026:post-1</id>
    <title>Atom entry one</title>
    <link rel="self" href="https://atom.example.com/self/1"/>
    <link rel="alternate" href="https://atom.example.com/posts/1"/>
    <summary type="html">&lt;p&gt;Summary &amp;amp; more&lt;/p&gt;</summary>
    <updated>2026-08-17T12:00:00Z</updated>
  </entry>
  <entry>
    <id>tag:atom.example.com,2026:post-2</id>
    <title>Atom entry two</title>
    <link href="https://atom.example.com/posts/2"/>
    <published>2026-08-16T09:00:00Z</published>
  </entry>
  <entry>
    <id>tag:atom.example.com,2026:post-3</id>
    <title></title>
    <link rel="alternate" href="https://atom.example.com/posts/3"/>
  </entry>
</feed>`;
