import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFfbbClient, FfbbError } from '../src/ffbb/client.js';

/** A fetch answering from a route table, recording what it was asked. */
function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, headers: options.headers });
    const path = url.replace('https://api.ffbb.app/', '').split('?')[0];
    const answer = routes[path]?.(options.headers);
    if (!answer) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    return {
      ok: answer.status === undefined,
      status: answer.status ?? 200,
      json: async () => answer.body,
    };
  };
  return { fetch, calls };
}

test('the token is read from the public configuration, once, and never in the URL', async () => {
  const { fetch, calls } = fakeFetch({
    'items/configuration': () => ({ body: { data: { id: 1, key_dh: 'tok-1', key_ms: 'ms' } } }),
    'json/lives.json': () => ({ body: [{ matchId: 1 }] }),
  });
  const client = createFfbbClient({ fetch });
  assert.deepEqual(await client.lives(), [{ matchId: 1 }]);
  assert.deepEqual(await client.lives(), [{ matchId: 1 }]);
  assert.deepEqual(
    calls.map((c) => c.url),
    [
      'https://api.ffbb.app/items/configuration',
      'https://api.ffbb.app/json/lives.json',
      'https://api.ffbb.app/json/lives.json',
    ],
  );
  assert.equal(calls[0].headers.authorization, undefined);
  assert.equal(calls[1].headers.authorization, 'Bearer tok-1');
  assert.equal(calls[1].headers['user-agent'], 'okhttp/4.12.0');
  assert.ok(calls.every((c) => !c.url.includes('tok-1')));
});

test('a refused token is read again, once', async () => {
  let token = 'old';
  const { fetch, calls } = fakeFetch({
    'items/configuration': () => ({ body: { data: { key_dh: token } } }),
    'items/ffbbserver_poules/42': (headers) =>
      headers.authorization === 'Bearer new' ? { body: { data: { id: 42 } } } : { status: 401 },
  });
  const client = createFfbbClient({ fetch });
  await client.poule(42).catch(() => {});
  token = 'new';
  assert.deepEqual(await client.poule(42), { id: 42 });
  assert.equal(calls.filter((c) => c.url.endsWith('configuration')).length, 3);
});

test('the competitions are filtered by code and the pool asks for its games', async () => {
  const { fetch, calls } = fakeFetch({
    'items/configuration': () => ({ body: { data: { key_dh: 't' } } }),
    'items/ffbbserver_competitions': () => ({ body: { data: [{ id: 1 }] } }),
    'items/ffbbserver_poules/7': () => ({ body: { data: { id: 7, rencontres: [] } } }),
  });
  const client = createFfbbClient({ fetch });
  assert.deepEqual(await client.competitions(['ELITE', 'PROA']), [{ id: 1 }]);
  const competitionUrl = new URL(calls[1].url);
  assert.equal(competitionUrl.searchParams.get('filter[code][_in]'), 'ELITE,PROA');
  assert.ok(competitionUrl.searchParams.getAll('fields[]').includes('saison.actif'));

  await client.poule(7);
  const pouleUrl = new URL(calls[2].url);
  const fields = pouleUrl.searchParams.getAll('fields[]');
  assert.ok(fields.includes('rencontres.date_rencontre'));
  assert.ok(fields.includes('rencontres.gsId.matchId'));
  assert.equal(pouleUrl.searchParams.get('deep[rencontres][_limit]'), '1000');
});

test('an HTTP error, a network error or a missing token are FfbbErrors', async () => {
  const noToken = createFfbbClient({
    fetch: fakeFetch({ 'items/configuration': () => ({ body: { data: {} } }) }).fetch,
  });
  await assert.rejects(noToken.lives(), FfbbError);

  const down = createFfbbClient({
    fetch: async () => {
      throw new Error('ECONNREFUSED');
    },
  });
  await assert.rejects(down.lives(), /FFBB unreachable: ECONNREFUSED/);

  const notFound = createFfbbClient({
    fetch: fakeFetch({ 'items/configuration': () => ({ body: { data: { key_dh: 't' } } }) }).fetch,
  });
  await assert.rejects(notFound.poule(1), (err) => err instanceof FfbbError && err.status === 404);
});
