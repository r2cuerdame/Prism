import type { MemorySite } from '../sourcePage';

/**
 * Two small in-memory "sites" with real navigation: a front page, a second
 * page reachable by an action, and a login-gated area. They stand in for a
 * Hacker-News-like community and a newspaper so tests can drive two isolated
 * source contexts and then compose their items into one page.
 */
export const HN_ORIGIN = 'https://news.example-community.com';
export const PAPER_ORIGIN = 'https://www.example-daily.com';

export function communitySite(): MemorySite {
  const o = HN_ORIGIN;
  return {
    documents: {
      [`${o}/`]: {
        title: 'Community — front page',
        elements: [
          { kind: 'link', label: 'AI chip race heats up as startups ship new accelerators', href: `${o}/item?id=1`, itemKind: 'post', summary: '토론 340개' },
          { kind: 'link', label: 'Rust compiler performance improvements land', href: `${o}/item?id=2`, itemKind: 'post' },
          { kind: 'link', label: 'Samsung foundry yields discussed by engineers', href: `${o}/item?id=3`, itemKind: 'post' },
          { kind: 'button', label: 'More', target: `${o}/news?p=2` },
          { kind: 'link', label: 'login', href: `${o}/login` },
          { kind: 'link', label: 'threads', href: `${o}/threads` }
        ]
      },
      [`${o}/news?p=2`]: {
        title: 'Community — page 2',
        elements: [
          { kind: 'link', label: 'Electric vehicle battery exports surge, engineers weigh in', href: `${o}/item?id=4`, itemKind: 'post' },
          { kind: 'link', label: 'Open source license debate summary', href: `${o}/item?id=5`, itemKind: 'post' },
          { kind: 'link', label: 'GPU launch teardown thread', href: `${o}/item?id=6`, itemKind: 'post' },
          { kind: 'button', label: 'More', target: `${o}/news?p=3` }
        ]
      },
      [`${o}/news?p=3`]: {
        title: 'Community — page 3',
        elements: [{ kind: 'link', label: 'Weekend project showcase', href: `${o}/item?id=7`, itemKind: 'post' }]
      },
      [`${o}/threads`]: {
        title: 'Your threads',
        requiresCookie: 'session',
        loginUrl: `${o}/login`,
        elements: [
          { kind: 'link', label: 'Your reply on the AI chip thread', href: `${o}/item?id=1#reply`, itemKind: 'post' },
          { kind: 'button', label: 'delete comment', target: `${o}/threads` }
        ]
      },
      [`${o}/login`]: {
        title: 'Login',
        elements: [
          { kind: 'input', label: 'username', inputType: 'text' },
          { kind: 'input', label: 'password', inputType: 'password' },
          { kind: 'form', label: 'login form', target: `${o}/login/done` }
        ]
      },
      [`${o}/login/done`]: {
        title: 'Logged in',
        setsCookies: { session: 'secret-session-cookie-value' },
        elements: [{ kind: 'link', label: 'threads', href: `${o}/threads` }]
      }
    }
  };
}

export function paperSite(): MemorySite {
  const o = PAPER_ORIGIN;
  return {
    documents: {
      [`${o}/`]: {
        title: 'Example Daily',
        elements: [
          { kind: 'link', label: 'AI chip race: new accelerators arrive from startups', href: `${o}/tech/ai-chip-race`, itemKind: 'article', summary: 'Startups ship accelerators' },
          { kind: 'link', label: 'Samsung foundry yields improve, report says', href: `${o}/biz/samsung-yields`, itemKind: 'article' },
          { kind: 'link', label: 'Housing market watch: rates steady', href: `${o}/biz/housing`, itemKind: 'headline' },
          { kind: 'link', label: '더 보기', href: `${o}/tech?page=2` }
        ]
      },
      [`${o}/tech?page=2`]: {
        title: 'Example Daily — tech 2',
        elements: [
          { kind: 'link', label: 'Electric vehicle battery exports surge to record', href: `${o}/biz/ev-battery`, itemKind: 'article' },
          { kind: 'link', label: 'GPU launch: what the new chip changes', href: `${o}/tech/gpu-launch`, itemKind: 'article' },
          { kind: 'link', label: 'Typhoon heads north this weekend', href: `${o}/weather/typhoon`, itemKind: 'headline' }
        ]
      }
    }
  };
}
