import type { BlockComponent } from './blockContract';
import VideoPlayerBlock from './VideoPlayerBlock';
import VideoQueueBlock from './VideoQueueBlock';
import HeadlineStripBlock from './HeadlineStripBlock';
import ArticleListBlock from './ArticleListBlock';
import ReaderBlock from './ReaderBlock';
import CommunityPostsBlock from './CommunityPostsBlock';
import SynthesisBriefBlock from './SynthesisBriefBlock';
import TopicClusterBlock from './TopicClusterBlock';
import SourceListBlock from './SourceListBlock';
import { HeadingBlock, TextBlock, DividerBlock } from './PrimitiveBlocks';

/** Trusted component registry: the ONLY code that renders generated content. */
export const BLOCK_REGISTRY: Record<string, BlockComponent> = {
  video_player: VideoPlayerBlock,
  video_queue: VideoQueueBlock,
  headline_strip: HeadlineStripBlock,
  article_list: ArticleListBlock,
  reader: ReaderBlock,
  community_posts: CommunityPostsBlock,
  synthesis_brief: SynthesisBriefBlock,
  topic_cluster: TopicClusterBlock,
  source_list: SourceListBlock,
  heading: HeadingBlock,
  text: TextBlock,
  divider: DividerBlock
};
