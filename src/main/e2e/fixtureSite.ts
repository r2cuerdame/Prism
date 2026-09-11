import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A tiny local website with three deterministic pages, used by the Electron
 * E2E run and by integration tests that want REAL hidden webContents loading
 * REAL documents over HTTP instead of a memory double.
 *
 *   /counter  — a click counter (button "더하기" increments #count in-page)
 *   /form     — a text input + submit; the server echoes what was saved
 *   /members  — cookie-gated; without the session cookie it redirects to
 *               /login, whose password form sets the cookie and comes back
 *
 * Every page also lists a few content links about the SAME topics, so the
 * three "sites" can contribute to one Prism topic cluster. Nothing here is
 * random: the same request always yields the same document.
 */

export const FIXTURE_COOKIE = 'prism_fixture_session';
export const FIXTURE_PASSWORD = 'open-sesame';

const TOPIC_LINKS: Record<string, { title: string; path: string }[]> = {
  counter: [
    { title: '반도체 수출 반등, 커뮤니티 반응은?', path: '/counter/thread/1' },
    { title: '전기차 보조금 개편 토론', path: '/counter/thread/2' },
    { title: '우주 발사체 재사용 실험 후기', path: '/counter/thread/3' }
  ],
  form: [
    { title: '반도체 수출 두 달 연속 증가', path: '/form/article/1' },
    { title: '전기차 보조금 개편안 발표', path: '/form/article/2' },
    { title: '우주 발사체 재사용 성공', path: '/form/article/3' }
  ],
  members: [
    { title: '반도체 공장 투어 영상', path: '/members/video/1' },
    { title: '전기차 배터리 교체 브이로그', path: '/members/video/2' },
    { title: '우주 발사 라이브 다시보기', path: '/members/video/3' }
  ]
};

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function page(title: string, body: string): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:sans-serif;margin:24px} .secret{display:none}</style>
<script>window.__fixtureSecret = 'never-projected';</script>
</head><body><h1>${esc(title)}</h1>${body}
<div class="secret" data-token="do-not-leak">hidden token</div>
</body></html>`;
}

function links(site: string): string {
  const rows = TOPIC_LINKS[site] ?? [];
  return `<ul class="topics">${rows
    .map((r) => `<li><a href="${r.path}" data-kind="${site === 'counter' ? 'post' : site === 'form' ? 'article' : 'video'}">${esc(r.title)}</a></li>`)
    .join('')}</ul>`;
}

function counterPage(): string {
  return page(
    '카운터 실험실',
    `<p>버튼을 누르면 이 페이지 안에서만 숫자가 올라가요.</p>
<button id="inc" type="button" onclick="document.getElementById('count').textContent = String(Number(document.getElementById('count').textContent) + 1)">더하기</button>
<p>현재 값: <span id="count" data-testid="count">0</span></p>
${links('counter')}`
  );
}

function formPage(saved: string | null): string {
  return page(
    '메모 저장소',
    `<form id="note-form" method="get" action="/form">
  <label for="note">메모</label>
  <input id="note" name="note" type="text" value="" placeholder="여기에 입력">
  <button type="submit">저장</button>
</form>
<p id="saved" data-testid="saved">${saved === null ? '저장된 메모 없음' : `저장됨: ${esc(saved)}`}</p>
${links('form')}`
  );
}

function loginPage(failed: boolean): string {
  return page(
    '회원 로그인',
    `<form id="login-form" method="post" action="/login">
  <label for="user">아이디</label><input id="user" name="user" type="text" value="">
  <label for="pass">비밀번호</label><input id="pass" name="pass" type="password" value="">
  <button type="submit">로그인</button>
</form>
${failed ? '<p id="error">비밀번호가 틀렸어요.</p>' : ''}
<p>회원 전용 영상은 로그인 후 볼 수 있어요.</p>`
  );
}

function membersPage(): string {
  return page(
    '회원 전용 영상',
    `<p id="welcome" data-testid="welcome">로그인됐어요. 회원 전용 목록이에요.</p>
<a href="/logout">로그아웃</a>
${links('members')}`
  );
}

function detailPage(kind: string, n: string): string {
  return page(`${kind} ${n}`, `<p>픽스처 상세 페이지 ${esc(kind)} #${esc(n)}</p><a href="/${kind === 'thread' ? 'counter' : kind === 'article' ? 'form' : 'members'}">목록으로</a>`);
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k] = decodeURIComponent(v.join('='));
  }
  return out;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c: Buffer | string) => {
      data += String(c);
    });
    req.on('end', () => resolve(data));
    req.on('error', () => resolve(data));
  });
}

function send(res: ServerResponse, status: number, html: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    ...headers
  });
  res.end(html);
}

export interface FixtureSite {
  /** e.g. http://127.0.0.1:53211 */
  origin: string;
  urls: { counter: string; form: string; members: string; login: string };
  close(): Promise<void>;
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://fixture.local');
  const path = url.pathname;
  const cookies = parseCookies(req);
  const signedIn = cookies[FIXTURE_COOKIE] === '1';

  if (path === '/' || path === '/counter') return send(res, 200, counterPage());
  if (path === '/form') return send(res, 200, formPage(url.searchParams.get('note')));
  if (path === '/members') {
    if (!signedIn) return send(res, 302, '', { location: '/login' });
    return send(res, 200, membersPage());
  }
  if (path === '/login' && req.method === 'GET') return send(res, 200, loginPage(false));
  if (path === '/login' && req.method === 'POST') {
    const body = new URLSearchParams(await readBody(req));
    if (body.get('pass') === FIXTURE_PASSWORD) {
      return send(res, 302, '', {
        location: '/members',
        'set-cookie': `${FIXTURE_COOKIE}=1; Path=/; HttpOnly`
      });
    }
    return send(res, 200, loginPage(true));
  }
  if (path === '/logout') {
    return send(res, 302, '', {
      location: '/login',
      'set-cookie': `${FIXTURE_COOKIE}=; Path=/; Max-Age=0`
    });
  }
  const detail = path.match(/^\/(counter|form|members)\/(thread|article|video)\/(\d+)$/);
  if (detail) {
    if (detail[1] === 'members' && !signedIn) return send(res, 302, '', { location: '/login' });
    return send(res, 200, detailPage(detail[2]!, detail[3]!));
  }
  send(res, 404, page('없는 페이지', '<p>404</p>'));
}

/** Starts the fixture site on a free loopback port. */
export function startFixtureSite(port = 0): Promise<FixtureSite> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      void handle(req, res).catch((err) => {
        send(res, 500, page('오류', `<pre>${esc(String(err))}</pre>`));
      });
    });
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      const origin = `http://127.0.0.1:${address.port}`;
      resolve({
        origin,
        urls: {
          counter: `${origin}/counter`,
          form: `${origin}/form`,
          members: `${origin}/members`,
          login: `${origin}/login`
        },
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          })
      });
    });
  });
}
