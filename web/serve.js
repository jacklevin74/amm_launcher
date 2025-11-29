#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3030;

const server = http.createServer((req, res) => {
  const filePath = req.url === '/' ? '/index.html' : req.url;
  const fullPath = path.join(__dirname, filePath);

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(fullPath);
    const contentTypes = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.json': 'application/json',
    };

    res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n🚀 Lottery AMM Web Interface`);
  console.log(`================================`);
  console.log(`Server running at http://localhost:${PORT}/`);
  console.log(``);
  console.log(`📋 Make sure to:`);
  console.log(`  1. Have Phantom wallet installed`);
  console.log(`  2. Have a local validator running (if using localhost)`);
  console.log(`  3. Have pools created via CLI tests first`);
  console.log(``);
  console.log(`Press Ctrl+C to stop the server`);
  console.log(``);
});
