"""Public Binance candles only; no credentials, order routes or account data."""
import concurrent.futures
import datetime as dt
import hashlib
import json
from pathlib import Path
import sys
import time
import urllib.parse
import urllib.request

CONFIG = json.loads((Path(__file__).parent / 'experiment.json').read_text())

def millis(iso):
    return int(dt.datetime.fromisoformat(iso.replace('Z', '+00:00')).timestamp() * 1000)

def fetch_pair(pair, directory):
    start, end = map(millis, [CONFIG['historyStart'], CONFIG['endExclusive']])
    rows, cursor, requests = [], start, []
    while cursor < end:
        query = urllib.parse.urlencode(dict(symbol=pair.replace('-', ''), interval='1h', startTime=cursor, endTime=end-1, limit=1000))
        url = 'https://api.binance.com/api/v3/klines?' + query
        for attempt in range(3):
            try:
                with urllib.request.urlopen(url, timeout=25) as response:
                    page = json.loads(response.read())
                if not isinstance(page, list) or not page:
                    raise ValueError('EMPTY_OR_INVALID_HISTORY ' + pair)
                break
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(1 + attempt)
        requests.append(url)
        for row in page:
            t = int(row[0])
            if t != cursor or int(row[6]) != t + CONFIG['barMs'] - 1:
                raise ValueError('GAP_OR_DUPLICATE ' + pair + ' ' + str(t))
            o, h, low, close, volume = map(float, row[1:6])
            if not (0 < low <= min(o, close) <= max(o, close) <= h and volume >= 0):
                raise ValueError('INVALID_OHLCV ' + pair)
            rows.append(dict(timestamp=t, open=o, high=h, low=low, close=close, volume=volume))
            cursor = t + CONFIG['barMs']
        if cursor <= int(page[0][0]):
            raise ValueError('NON_ADVANCING_PAGE')
        time.sleep(0.1)
    if cursor != end:
        raise ValueError('END_MISMATCH')
    target = directory / (pair + '.json')
    target.write_text(json.dumps(rows, separators=(',', ':')))
    result = dict(pair=pair, rows=len(rows), first=rows[0]['timestamp'], last=rows[-1]['timestamp'], sha256=hashlib.sha256(target.read_bytes()).hexdigest(), requests=requests)
    print(json.dumps({k: v for k, v in result.items() if k != 'requests'}), flush=True)
    return result

if __name__ == '__main__':
    directory = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/anton-research-data')
    directory.mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(lambda pair: fetch_pair(pair, directory), CONFIG['pairs']))
    manifest = dict(venue='Binance public Spot API', fetchedAt=dt.datetime.now(dt.timezone.utc).isoformat(), config=CONFIG, files=results)
    (directory / 'manifest.json').write_text(json.dumps(manifest, indent=2))
