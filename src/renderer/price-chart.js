'use strict';

(() => {
  const date = value => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  class PriceChart {
    constructor(canvas, summary, pick) {
      Object.assign(this, { canvas, summary, pick }); this.points = []; this.reference = null; this.selected = null;
      this.observer = new ResizeObserver(() => this.draw()); this.observer.observe(canvas);
      canvas.addEventListener('pointermove', event => {
        if (!this.points.length || !this.bounds) return;
        const rect = canvas.getBoundingClientRect(), ratio = (event.clientX - rect.left - this.bounds.left) / this.bounds.width;
        const time = this.points[0].t + Math.max(0, Math.min(1, ratio)) * (this.points.at(-1).t - this.points[0].t);
        let closest = 0;
        for (let i = 1; i < this.points.length; i += 1) if (Math.abs(this.points[i].t - time) < Math.abs(this.points[closest].t - time)) closest = i;
        if (closest !== this.selected) { this.selected = closest; this.draw(); }
      });
      canvas.addEventListener('pointerleave', () => { this.selected = null; this.draw(); });
    }

    update(points, reference = null) {
      this.points = points || []; this.available = points !== null && points !== undefined; this.reference = reference; this.selected = null;
      const shortDate = value => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
      this.summary.title = this.points.length ? `${date(this.points[0].t)} 至 ${date(this.points.at(-1).t)}` : '';
      this.summary.textContent = this.points.length ? `${this.points.length.toLocaleString()} 点 · ${shortDate(this.points[0].t)}–${shortDate(this.points.at(-1).t)}`
        : this.available ? '服务器历史为空' : '尚未取得历史数据';
      this.draw();
    }

    draw(force = false) {
      const rect = this.canvas.getBoundingClientRect();
      if (!rect.width || !rect.height || (document.hidden && force !== true)) return;
      const ratio = Math.min(2, window.devicePixelRatio || 1), width = rect.width, height = rect.height;
      this.canvas.width = Math.round(width * ratio); this.canvas.height = Math.round(height * ratio);
      const ctx = this.canvas.getContext('2d'); if (!ctx) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height); ctx.font = '11px Microsoft YaHei, sans-serif';
      const left = 12, right = 92, top = 20, bottom = 30, plotWidth = Math.max(1, width - left - right), plotHeight = height - top - bottom;
      this.bounds = { left, width: plotWidth };
      if (!this.points.length) { ctx.fillStyle = '#91a5bd'; ctx.fillText(this.available ? '暂无历史走势' : '等待有效行情', left + 15, height / 2); this.pick.textContent = '历史数据来自服务器，不补造缺失记录。'; return; }
      const values = this.points.map(point => Number(point.price)), reference = this.reference === null ? null : Number(this.reference);
      let low = Math.min(...values), high = Math.max(...values);
      if (Number.isFinite(reference)) { low = Math.min(low, reference); high = Math.max(high, reference); }
      const padding = Math.max((high - low) * .12, Math.abs(high) * .005, .01); low -= padding; high += padding;
      const start = this.points[0].t, span = this.points.at(-1).t - start;
      const x = index => left + (span ? (this.points[index].t - start) / span : .5) * plotWidth;
      const y = value => top + (high - value) / (high - low) * plotHeight;
      ctx.strokeStyle = '#304258'; ctx.lineWidth = 1; ctx.fillStyle = '#91a5bd';
      for (let i = 0; i < 4; i += 1) {
        const value = low + (high - low) * (i + .5) / 4, py = y(value);
        ctx.beginPath(); ctx.moveTo(left, py); ctx.lineTo(left + plotWidth, py); ctx.stroke();
        ctx.fillText(value.toLocaleString('en-US', { maximumFractionDigits: 2 }), left + plotWidth + 10, py + 4);
      }
      if (Number.isFinite(reference)) {
        ctx.save(); ctx.strokeStyle = '#8c99c0'; ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(left, y(reference)); ctx.lineTo(left + plotWidth, y(reference)); ctx.stroke(); ctx.restore();
        ctx.fillStyle = '#a7b4d5'; ctx.fillText('本期开盘', left + 5, y(reference) - 5);
      }
      const color = values.at(-1) >= (reference ?? values[0]) ? '#eda899' : '#8eddbe';
      const gradient = ctx.createLinearGradient(0, top, 0, top + plotHeight); gradient.addColorStop(0, color + '42'); gradient.addColorStop(1, color + '00');
      const step = Math.max(1, Math.ceil(values.length / 700)), indices = [];
      for (let i = 0; i < values.length; i += step) indices.push(i);
      if (indices.at(-1) !== values.length - 1) indices.push(values.length - 1);
      ctx.beginPath(); ctx.moveTo(x(0), top + plotHeight); for (const i of indices) ctx.lineTo(x(i), y(values[i]));
      ctx.lineTo(x(values.length - 1), top + plotHeight); ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();
      ctx.beginPath(); indices.forEach((i, n) => n ? ctx.lineTo(x(i), y(values[i])) : ctx.moveTo(x(i), y(values[i])));
      ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.strokeStyle = color; ctx.stroke();
      const selected = this.selected ?? values.length - 1;
      if (this.selected !== null) {
        ctx.save(); ctx.setLineDash([3, 4]); ctx.strokeStyle = '#91a5bd'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x(selected), top); ctx.lineTo(x(selected), top + plotHeight); ctx.stroke(); ctx.restore();
      }
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x(selected), y(values[selected]), 4, 0, Math.PI * 2); ctx.fill();
      this.pick.textContent = `${this.selected === null ? '最后历史点' : '选中历史点'}：${date(this.points[selected].t)} · 价格 ${window.formatNumber(this.points[selected].price)}`;
      ctx.fillStyle = '#91a5bd'; ctx.fillText(new Date(start).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' }), left, height - 8);
      ctx.textAlign = 'right'; ctx.fillText(new Date(this.points.at(-1).t).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' }), left + plotWidth, height - 8);
    }
  }
  window.PriceChart = PriceChart;
})();
