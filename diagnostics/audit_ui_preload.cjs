// Diagnostic observation only: preserve every Canvas call and return value.
window.__auditCalls = [];
for (const method of ['fillRect', 'strokeRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fillText']) {
  const original = CanvasRenderingContext2D.prototype[method];
  CanvasRenderingContext2D.prototype[method] = function (...args) {
    if (method === 'fillRect' && args[0] === 0 && args[1] === 0 && args[2] > 500 && args[3] > 100) {
      window.__auditCalls = [];
    }
    if (window.__auditCalls.length < 30000) {
      window.__auditCalls.push({ method, args, fill: this.fillStyle, stroke: this.strokeStyle });
    }
    return original.apply(this, args);
  };
}
