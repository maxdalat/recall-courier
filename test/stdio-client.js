import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENTRY = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'index.js');

// Talks to the real server process over stdio, the way Claude does.
export class StdioClient {
  constructor(env) {
    this.child = spawn(process.execPath, [ENTRY], { env: { PATH: process.env.PATH, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    this.buffer = '';
    this.lines = [];
    this.waiters = [];
    this.stderr = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => {
      this.buffer += chunk;
      let i;
      while ((i = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + 1);
        this.lines.push(line);
        this.waiters.shift()?.();
      }
    });
    this.child.stderr.on('data', (c) => { this.stderr += c; });
    this.exited = new Promise((resolve) => this.child.on('exit', (code) => resolve(code)));
    this.nextId = 1;
  }

  send(message) {
    this.child.stdin.write(`${typeof message === 'string' ? message : JSON.stringify(message)}\n`);
  }

  async read() {
    while (this.lines.length === 0) await new Promise((resolve) => this.waiters.push(resolve));
    return JSON.parse(this.lines.shift());
  }

  async request(method, params) {
    const id = this.nextId++;
    this.send({ jsonrpc: '2.0', id, method, params });
    const reply = await this.read();
    assert.equal(reply.id, id);
    return reply;
  }

  async call(name, args) {
    const reply = await this.request('tools/call', { name, arguments: args });
    assert.ok(reply.result, JSON.stringify(reply));
    return { isError: Boolean(reply.result.isError), text: reply.result.content[0].text };
  }

  async close() {
    this.child.stdin.end();
    return Promise.race([this.exited, new Promise((resolve) => setTimeout(() => { this.child.kill(); resolve('killed'); }, 3000))]);
  }
}

