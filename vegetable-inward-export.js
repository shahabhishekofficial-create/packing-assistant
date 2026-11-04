/* Vegetable Inward — Excel and PDF export.

   Prepare, then Download or Share. The libraries are fetched only when the
   admin taps Prepare. Percentages and totals come from the database summary;
   the only arithmetic done here is per row (a single trip's own A / total) and
   kilogram conversion of the gram values the server returned. */

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const XLSX_URL = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
  const PDF_URL = "https://cdn.jsdelivr.net/npm/jspdf@3.0.4/dist/jspdf.umd.min.js";
  const TABLE_URL = "https://cdn.jsdelivr.net/npm/jspdf-autotable@5.0.8/dist/jspdf.plugin.autotable.min.js";

  const state = { file: null, fileName: "", kind: "", busy: false };

  function message(text) {
    const el = $("viExportMessage");
    if (el) el.textContent = text || "";
  }

  function loadLibrary(url, ready) {
    if (ready()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const existing = [...document.scripts].find((s) => s.src === url);
      if (existing) {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () => reject(new Error("load failed")));
        if (ready()) resolve();
        return;
      }
      const script = document.createElement("script");
      script.src = url;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Could not load the export library. Check the connection and retry."));
      document.head.append(script);
    });
  }

  /* --------------------------------------------------------------- helpers */

  const grams = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const kgNumber = (v) => {
    const g = grams(v);
    return g === null ? null : Math.round(g) / 1000;
  };
  const pctNumber = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  /* India date parts, used for Date.UTC so the sheet shows dd/mm/yyyy. */
  function indiaParts(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const p = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(d).reduce((all, part) => ((all[part.type] = part.value), all), {});
    return p;
  }
  const excelDate = (iso) => {
    const p = indiaParts(iso);
    if (!p) return null;
    return new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)));
  };
  const ddmm = (iso) => {
    const p = indiaParts(iso);
    return p ? `${p.day}/${p.month}/${p.year}` : "";
  };
  const hhmm = (iso) => {
    const p = indiaParts(iso);
    return p ? `${p.hour}:${p.minute}` : "";
  };
  const indiaTodayString = () => {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date())
      .reduce((all, part) => ((all[part.type] = part.value), all), {});
    return `${p.year}-${p.month}-${p.day}`;
  };
  const dateOnly = (isoDate) => {
    const m = String(isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(isoDate || "");
  };

  async function collect() {
    const admin = window.VI_ADMIN;
    if (!admin) throw new Error("The page is still loading. Retry in a moment.");
    const filters = admin.filters();
    const summary = await admin.api("summary", filters);
    const rows = Array.isArray(summary.rows) ? summary.rows : [];
    const entries = [];
    for (let offset = 0; ; offset += 1000) {
      const page = await admin.api("export_rows", { ...filters, offset });
      const batch = Array.isArray(page.rows) ? page.rows : [];
      entries.push(...batch);
      if (page.done) break;
      if (offset > 200000) throw new Error("This period is too large to export.");
    }
    return { rows, totals: summary.totals || null, entries, filters, labels: admin.filterLabels(), stem: admin.fileStem() };
  }

  /* ----------------------------------------------------------------- Excel */

  async function buildExcel(data) {
    await loadLibrary(XLSX_URL, () => !!window.ExcelJS);
    const ExcelJS = window.ExcelJS;
    const wb = new ExcelJS.Workbook();
    wb.creator = "Bigly Agro";
    wb.created = new Date();

    /* 1. Summary */
    const summary = wb.addWorksheet("Summary");
    summary.columns = [{ width: 30 }, { width: 22 }];
    summary.addRow(["Vegetable Inward"]).font = { bold: true, size: 14 };
    summary.addRow([]);
    data.labels.forEach(([label, value]) => {
      const row = summary.addRow([String(label), String(value)]);
      row.getCell(1).font = { bold: true };
    });
    summary.addRow([]);
    const t = data.totals || {};
    const totalRow = data.rows.find((r) => r.row_kind === "total") || {};
    const kv = [
      ["Trips", Number(t.trips || 0)],
      ["Total received (kg)", kgNumber(t.total_g)],
      ["Sorted (kg)", kgNumber(t.sorted_g)],
      ["A grade (kg)", kgNumber(t.a_g)],
      ["A grade %", pctNumber(totalRow.a_pct)],
      ["B grade (kg)", kgNumber(t.b_g)],
      ["B grade %", pctNumber(totalRow.b_pct)],
      ["Dump (kg)", kgNumber(t.dump_g)],
      ["Dump %", pctNumber(totalRow.dump_pct)],
      ["Unaccounted (kg)", kgNumber(t.unaccounted_g)],
      ["Sorting pending (kg)", kgNumber(t.pending_g)],
    ];
    kv.forEach(([label, value]) => {
      const row = summary.addRow([label, value]);
      row.getCell(1).font = { bold: true };
      if (value !== null && value !== undefined) row.getCell(2).numFmt = label.includes("%") ? "0.0" : "0.000";
    });
    summary.addRow([]);
    summary.addRow(["Percentages are calculated from sorted entries only, by the database."]).font = { italic: true, color: { argb: "FF657B6D" } };

    /* 2. By Item and Vendor (grouped, with subtotal rows) */
    const grouped = wb.addWorksheet("By Item and Vendor");
    grouped.columns = [
      { header: "Vegetable", width: 28 },
      { header: "Vendor", width: 24 },
      { header: "Trips", width: 8 },
      { header: "Total kg", width: 12 },
      { header: "Sorted kg", width: 12 },
      { header: "A kg", width: 10 },
      { header: "A %", width: 8 },
      { header: "B kg", width: 10 },
      { header: "B %", width: 8 },
      { header: "Dump kg", width: 10 },
      { header: "Dump %", width: 9 },
      { header: "Pending kg", width: 12 },
    ];
    grouped.getRow(1).font = { bold: true };
    data.rows.filter((r) => r.row_kind !== "total").forEach((row) => {
      const isItem = row.row_kind === "item";
      const added = grouped.addRow([
        String(row.item_name || ""),
        isItem ? "All vendors" : String(row.vendor_name || ""),
        Number(row.trips || 0),
        kgNumber(row.total_g),
        kgNumber(row.sorted_g),
        kgNumber(row.a_g),
        pctNumber(row.a_pct),
        kgNumber(row.b_g),
        pctNumber(row.b_pct),
        kgNumber(row.dump_g),
        pctNumber(row.dump_pct),
        kgNumber(row.pending_g),
      ]);
      if (isItem) added.font = { bold: true };
      [4, 5, 6, 8, 10, 12].forEach((c) => (added.getCell(c).numFmt = "0.000"));
      [7, 9, 11].forEach((c) => (added.getCell(c).numFmt = "0.0"));
    });
    const total = data.rows.find((r) => r.row_kind === "total");
    if (total) {
      const added = grouped.addRow([
        "GRAND TOTAL",
        "",
        Number(total.trips || 0),
        kgNumber(total.total_g),
        kgNumber(total.sorted_g),
        kgNumber(total.a_g),
        pctNumber(total.a_pct),
        kgNumber(total.b_g),
        pctNumber(total.b_pct),
        kgNumber(total.dump_g),
        pctNumber(total.dump_pct),
        kgNumber(total.pending_g),
      ]);
      added.font = { bold: true };
      added.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F2EC" } }));
      [4, 5, 6, 8, 10, 12].forEach((c) => (added.getCell(c).numFmt = "0.000"));
      [7, 9, 11].forEach((c) => (added.getCell(c).numFmt = "0.0"));
    }
    grouped.views = [{ state: "frozen", ySplit: 1 }];

    /* 3. Entries */
    const entries = wb.addWorksheet("Entries");
    entries.columns = [
      { header: "Date", width: 12 },
      { header: "Time", width: 8 },
      { header: "Vendor", width: 22 },
      { header: "Vegetable", width: 24 },
      { header: "Total kg", width: 11 },
      { header: "A kg", width: 10 },
      { header: "B kg", width: 10 },
      { header: "Dump kg", width: 10 },
      { header: "Unaccounted kg", width: 15 },
      { header: "A %", width: 8 },
      { header: "B %", width: 8 },
      { header: "Dump %", width: 9 },
      { header: "Note", width: 24 },
    ];
    entries.getRow(1).font = { bold: true };
    data.entries.forEach((entry) => {
      const totalG = grams(entry.total_g) || 0;
      const sorted = entry.sorted;
      const a = grams(entry.a_g);
      const b = grams(entry.b_g);
      const d = grams(entry.dump_g);
      const unaccounted = sorted ? totalG - ((a || 0) + (b || 0) + (d || 0)) : null;
      const row = entries.addRow([
        excelDate(entry.received_at),
        hhmm(entry.received_at),
        String(entry.vendor_name || ""),
        String(entry.item_name || ""),
        totalG / 1000,
        sorted ? (a || 0) / 1000 : null,
        sorted ? (b || 0) / 1000 : null,
        sorted ? (d || 0) / 1000 : null,
        unaccounted === null ? null : unaccounted / 1000,
        sorted && totalG > 0 ? Math.round((a || 0) * 1000 / totalG) / 10 : null,
        sorted && totalG > 0 ? Math.round((b || 0) * 1000 / totalG) / 10 : null,
        sorted && totalG > 0 ? Math.round((d || 0) * 1000 / totalG) / 10 : null,
        String(entry.notes || ""),
      ]);
      row.getCell(1).numFmt = "dd/mm/yyyy";
      [5, 6, 7, 8, 9].forEach((c) => (row.getCell(c).numFmt = "0.000"));
      [10, 11, 12].forEach((c) => (row.getCell(c).numFmt = "0.0"));
    });
    entries.views = [{ state: "frozen", ySplit: 1 }];

    /* 4. Vendor Comparison */
    const compare = wb.addWorksheet("Vendor Comparison");
    compare.columns = [
      { header: "Vegetable", width: 26 },
      { header: "Vendor", width: 24 },
      { header: "Trips", width: 8 },
      { header: "Total kg", width: 12 },
      { header: "A kg", width: 10 },
      { header: "A %", width: 8 },
      { header: "B kg", width: 10 },
      { header: "B %", width: 8 },
      { header: "Dump kg", width: 10 },
      { header: "Dump %", width: 9 },
      { header: "Pending kg", width: 12 },
    ];
    compare.getRow(1).font = { bold: true };
    const vendorRows = data.rows
      .filter((r) => r.row_kind === "vendor")
      .slice()
      .sort((a, b) => String(a.item_name || "").localeCompare(String(b.item_name || "")) || (Number(b.a_pct ?? -1) - Number(a.a_pct ?? -1)));
    vendorRows.forEach((row) => {
      const added = compare.addRow([
        String(row.item_name || ""),
        String(row.vendor_name || ""),
        Number(row.trips || 0),
        kgNumber(row.total_g),
        kgNumber(row.a_g),
        pctNumber(row.a_pct),
        kgNumber(row.b_g),
        pctNumber(row.b_pct),
        kgNumber(row.dump_g),
        pctNumber(row.dump_pct),
        kgNumber(row.pending_g),
      ]);
      [4, 5, 7, 9, 11].forEach((c) => (added.getCell(c).numFmt = "0.000"));
      [6, 8, 10].forEach((c) => (added.getCell(c).numFmt = "0.0"));
    });
    compare.views = [{ state: "frozen", ySplit: 1 }];

    const buffer = await wb.xlsx.writeBuffer();
    return new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  /* ------------------------------------------------------------------- PDF */

  async function buildPdf(data) {
    await loadLibrary(PDF_URL, () => !!(window.jspdf && window.jspdf.jsPDF));
    await loadLibrary(TABLE_URL, () => !!(window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API.autoTable));
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const width = doc.internal.pageSize.getWidth();

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Vegetable Inward", 40, 42);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Period: ${data.labels[0][1]}`, 40, 60);
    doc.text(data.labels.slice(1).map(([label, value]) => `${label}: ${value}`).join("   ·   "), 40, 74);
    doc.setFontSize(9);
    doc.text(`Prepared ${dateOnly(indiaTodayString())} · kilogram values, percentages from sorted entries only`, 40, 88);

    const body = [];
    data.rows.filter((r) => r.row_kind !== "total").forEach((row) => {
      const strong = row.row_kind === "item";
      body.push([
        {
          content: strong ? String(row.item_name || "") : "   " + String(row.vendor_name || ""),
          styles: { fontStyle: strong ? "bold" : "normal" },
        },
        String(row.trips || 0),
        kgText(row.total_g),
        kgText(row.a_g),
        pctPdf(row.a_pct),
        kgText(row.b_g),
        pctPdf(row.b_pct),
        kgText(row.dump_g),
        pctPdf(row.dump_pct),
        kgText(row.pending_g),
      ]);
    });
    const total = data.rows.find((r) => r.row_kind === "total");
    if (total) {
      body.push([
        { content: "GRAND TOTAL", styles: { fontStyle: "bold" } },
        String(total.trips || 0),
        kgText(total.total_g),
        kgText(total.a_g),
        pctPdf(total.a_pct),
        kgText(total.b_g),
        pctPdf(total.b_pct),
        kgText(total.dump_g),
        pctPdf(total.dump_pct),
        kgText(total.pending_g),
      ]);
    }

    doc.autoTable({
      startY: 100,
      head: [["Vegetable / Vendor", "Trips", "Total kg", "A kg", "A %", "B kg", "B %", "Dump kg", "Dump %", "Pending kg"]],
      body,
      theme: "grid",
      styles: { font: "helvetica", fontSize: 8, cellPadding: 4, overflow: "linebreak" },
      headStyles: { fillColor: [23, 107, 69], textColor: 255, fontStyle: "bold" },
      columnStyles: {
        0: { cellWidth: width * 0.24 },
        1: { halign: "right", cellWidth: 40 },
        2: { halign: "right" },
        3: { halign: "right" },
        4: { halign: "right" },
        5: { halign: "right" },
        6: { halign: "right" },
        7: { halign: "right" },
        8: { halign: "right" },
        9: { halign: "right" },
      },
      didParseCell: (hook) => {
        if (hook.section === "body") {
          const first = hook.row.raw && hook.row.raw[0];
          const text = typeof first === "object" ? first.content : String(first || "");
          if (text === "GRAND TOTAL" || (text && !text.startsWith("   "))) {
            hook.cell.styles.fontStyle = "bold";
            hook.cell.styles.fillColor = [232, 242, 236];
          }
        }
      },
      margin: { left: 40, right: 40, top: 100 },
      showHead: "everyPage",
    });

    const pages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pages; i += 1) {
      doc.setPage(i);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(`Page ${i} of ${pages}`, width - 40, doc.internal.pageSize.getHeight() - 18, { align: "right" });
      doc.text(`Vegetable Inward · ${data.labels[0][1]}`, 40, doc.internal.pageSize.getHeight() - 18);
    }
    return doc.output("blob");
  }

  const kgText = (v) => {
    const n = kgNumber(v);
    if (n === null) return "—";
    return n.toFixed(3).replace(/\.000$/, "").replace(/(\.\d{2})0$/, "$1").replace(/(\.\d)0$/, "$1");
  };
  const pctPdf = (v) => {
    const n = pctNumber(v);
    return n === null ? "—" : n.toFixed(1) + "%";
  };

  /* ---------------------------------------------------------------- actions */

  function reset() {
    state.file = null;
    state.fileName = "";
    $("viExportDownload").hidden = true;
    $("viExportShare").hidden = true;
  }

  async function prepare() {
    if (state.busy) return;
    state.busy = true;
    const button = $("viExportPrepare");
    button.disabled = true;
    button.textContent = "Preparing…";
    reset();
    message("Reading the summary and entries…");
    try {
      const data = await collect();
      const format = ($("viExportFormat") && $("viExportFormat").value) || "xlsx";
      const stem = (data.stem || "Vegetable_Inward_period").replace(/^Vegetable_Inward_/, "");
      if (format === "pdf") {
        state.file = await buildPdf(data);
        state.fileName = `Vegetable_Inward_${stem}.pdf`;
      } else {
        state.file = await buildExcel(data);
        state.fileName = `Vegetable_Inward_${stem}.xlsx`;
      }
      $("viExportDownload").hidden = false;
      $("viExportShare").hidden = false;
      message(`Prepared ${state.fileName} with ${data.entries.length} ${data.entries.length === 1 ? "entry" : "entries"}. Tap Download or Share.`);
    } catch (e) {
      message(e.message || "Could not prepare the file.");
    } finally {
      state.busy = false;
      button.disabled = false;
      button.textContent = "Prepare";
    }
  }

  function download() {
    if (!state.file) return;
    const url = URL.createObjectURL(state.file);
    const a = document.createElement("a");
    a.href = url;
    a.download = state.fileName;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    message("Downloaded " + state.fileName);
  }

  async function share() {
    if (!state.file) return;
    if (typeof navigator.share !== "function" || typeof File === "undefined") {
      message("This phone cannot share files. Tap Download instead.");
      return;
    }
    const file = new File([state.file], state.fileName, { type: state.file.type });
    if (navigator.canShare && !navigator.canShare({ files: [file] })) {
      message("This phone cannot share files. Tap Download instead.");
      return;
    }
    try {
      await navigator.share({ files: [file], title: state.fileName });
      message("Shared " + state.fileName);
    } catch (e) {
      message(e && e.name === "AbortError" ? "Sharing cancelled. The prepared file is still here." : "Could not share. Tap Download instead.");
    }
  }

  function wire() {
    const prepareButton = $("viExportPrepare");
    if (!prepareButton) return;
    prepareButton.addEventListener("click", () => void prepare());
    const format = $("viExportFormat");
    if (format) format.addEventListener("change", () => { reset(); message("Format changed. Tap Prepare."); });
    $("viExportDownload").addEventListener("click", download);
    $("viExportShare").addEventListener("click", () => void share());
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();
