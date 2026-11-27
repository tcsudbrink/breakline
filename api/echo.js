export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ url: req.url, headers: Object.fromEntries(Object.entries(req.headers).filter(([k]) => /url|path|forward|vercel|matched/i.test(k))) }));
}
