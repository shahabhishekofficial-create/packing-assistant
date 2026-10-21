(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const API = "https://pbhkuofylhqcqmspubmb.supabase.co/functions/v1/expense-api";
  const VERSION = "20261019-export1";
  const state = { file: null, fileName: "", busy: false };
  const controls = $("expenseExportControls");
  const prepare = $("expenseExportPrepare");
  const share = $("expenseExportShare");
  const download = $("expenseExportDownload");
  const message = $("expenseExportMessage");

  function todayIndia() {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date()).map(x => [x.type, x.value]));
    return p.year + "-" + p.month + "-" + p.day;
  }
  function shiftDate(date, months) {
    const d = new Date(date + "T12:00:00+05:30");
    d.setMonth(d.getMonth() + months);
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
  }
  function addDays(date, days) {
    const d = new Date(date + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function currentFilters() {
    const today = todayIndia();
    const mode = $("expenseListPeriod").value;
    let from = "", to = "";
    if (mode === "this") { from = today.slice(0, 7) + "-01"; to = today; }
    else if (mode === "last") {
      const monthStart = today.slice(0, 7) + "-01";
      const prior = shiftDate(monthStart, -1);
      from = prior.slice(0, 7) + "-01";
      to = addDays(monthStart, -1);
    } else if (mode === "custom") {
      from = $("expenseListFrom").value;
      to = $("expenseListTo").value;
    }
    return {
      from_date: from,
      to_date: to,
      category_id: $("expenseListCategory").value,
      status: $("expenseListStatus").value,
      reason_search: $("expenseListSearch").value.trim(),
      period_label: from || to ? (from || "Beginning") + " to " + (to || "Today") : "All dates",
      filter_labels: [
        ["Date range", from || to ? (from || "Beginning") + " to " + (to || "Today") : "All dates"],
        ["Category", $("expenseListCategory").selectedOptions[0]?.textContent || "All categories"],
        ["Status", $("expenseListStatus").selectedOptions[0]?.textContent || "All expenses"],
        ["Reason search", $("expenseListSearch").value.trim() || "None"]
      ]
    };
  }
  function moneyFromPaise(value) {
    if (value === undefined || value === null || !/^\d+$/.test(String(value))) return null;
    return Number(value) / 100;
  }
  function first(obj, keys) {
    for (const key of keys) if (obj && obj[key] !== undefined && obj[key] !== null) return obj[key];
    return null;
  }
  function text(value) { return value === null || value === undefined ? "" : String(value); }
  function indianMoney(value) {
    return "Rs. " + Number(value).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }
  function displayDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(value));
    return match ? match[3] + "/" + match[2] + "/" + match[1] : text(value);
  }
  function displayDates(value) {
    return text(value).replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_, y, m, d) => d + "/" + m + "/" + y);
  }
  function excelDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(value));
    if (!match) return text(value);
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  }
  function show(msg) { message.textContent = msg; }
  function setBusy(value) {
    state.busy = value;
    prepare.disabled = value;
    prepare.textContent = value ? "Preparing…" : "Prepare";
  }
  async function loadLibrary(url, test) {
    if (test()) return;
    await new Promise((resolve, reject) => {
      const existing = [...document.scripts].find(s => s.src === url);
      if (existing) {
        if (test()) return resolve();
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", () => reject(new Error("Could not load export library. Check your connection and retry.")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = url;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Could not load export library. Check your connection and retry."));
      document.head.append(script);
    });
    if (!test()) throw new Error("The export library did not initialize. Retry Prepare.");
  }
  async function fetchExport(filters) {
    const token = window.PA_ADMIN_SESSION || "";
    if (!token) throw new Error("Your admin session expired. Sign in again and retry.");
    let response;
    try {
      response = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "export_rows",
          admin_session: token,
          from_date: filters.from_date,
          to_date: filters.to_date,
          category_id: filters.category_id,
          status: filters.status,
          reason_search: filters.reason_search
        }),
        cache: "no-store"
      });
    } catch (_) {
      throw new Error("Export request failed. Your expense list and Add Expense remain available.");
    }
    let result;
    try { result = await response.json(); }
    catch (_) { throw new Error("The export service returned an unreadable response. Your expense list and Add Expense remain available."); }
    if (!response.ok || result.ok !== true) {
      const code = result.code || "";
      const serverMessage = result.message || "Export could not be prepared.";
      if (code === "DATA_CHANGED" || code === "EXPORT_ROW_LIMIT_EXCEEDED") throw new Error(serverMessage);
      throw new Error(serverMessage + " Your expense list and Add Expense remain available.");
    }
    if (!result.summary || !Array.isArray(result.expenses)) {
      throw new Error("The export response is incomplete. Your expense list and Add Expense remain available.");
    }
    return { summary: result.summary, rows: result.expenses };
  }
  function summaryName(summary) {
    const v = first(summary, ["employee_name", "name", "employee"]);
    if (v && typeof v === "object") return text(first(v, ["name", "full_name", "display_name"]));
    return text(v) || "Unknown (not supplied by summary)";
  }
  function categoryTotals(summary) {
    const value = first(summary, ["category_totals", "categories", "totals_by_category"]);
    return Array.isArray(value) ? value : [];
  }
  function categoryName(item) {
    return text(first(item, ["category_name", "name", "category", "label"]));
  }
  function categoryAmount(item) {
    const paise = first(item, ["total_paise", "amount_paise", "total_amount_paise"]);
    if (paise !== null) return moneyFromPaise(paise);
    const rupees = first(item, ["total_amount", "amount", "total"]);
    return rupees === null ? null : Number(rupees);
  }
  function summaryDetails(summary, filters) {
    const total = moneyFromPaise(summary.total_paise);
    const asOf = text(first(summary, ["as_of_date", "as_of", "balance_as_of"])) || todayIndia();
    const paymentsPaise = first(summary, ["overall_payments_received_paise", "overall_payments_paise", "total_payments_paise", "payments_paise", "payments_total_paise"]);
    const duePaise = first(summary, ["balance_due_paise", "overall_balance_due_paise", "total_due_paise", "due_paise"]);
    const payments = paymentsPaise === null ? first(summary, ["overall_payments", "total_payments", "payments_total"]) : moneyFromPaise(paymentsPaise);
    const due = duePaise === null ? first(summary, ["balance_due", "overall_balance_due", "total_due"]) : moneyFromPaise(duePaise);
    const serverPeriod = first(summary, ["period", "period_label"]);
    return {
      name: summaryName(summary),
      period: typeof serverPeriod === "string" ? serverPeriod : filters.period_label,
      total,
      categories: categoryTotals(summary),
      payments: payments === null ? "Not supplied by server summary" : payments,
      due: due === null ? "Not supplied by server summary" : due,
      asOf
    };
  }
  function safeTextCell(value) {
    // Explicit string assignment and text number format keep user text out of formula cells.
    // No apostrophe is added unless a real spreadsheet test proves one is required.
    return text(value);
  }
  function dateForFile(filters) {
    if (!filters.from_date && !filters.to_date) return "all_" + todayIndia();
    return (filters.from_date || "all") + "_to_" + (filters.to_date || todayIndia());
  }
  function fileName(filters, ext) { return "Expenses_" + dateForFile(filters) + "." + ext; }
  function setFile(file, name) {
    state.file = file;
    state.fileName = name;
    share.hidden = false;
    download.hidden = false;
    share.disabled = false;
    download.disabled = false;
  }
  function hideFileActions() {
    state.file = null;
    state.fileName = "";
    share.hidden = true;
    download.hidden = true;
  }
  async function buildExcel(payload, filters) {
    await loadLibrary("https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js", () => !!window.ExcelJS);
    const ExcelJS = window.ExcelJS;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Bigly Agro Admin";
    const summary = payload.summary;
    const detail = summaryDetails(summary, filters);
    const sheet = workbook.addWorksheet("Summary");
    sheet.columns = [{ width: 30 }, { width: 42 }];
    const summaryRows = [
      ["Employee", detail.name],
      ["Period", detail.period],
      ["Filter — Date range", filters.filter_labels[0][1]],
      ["Filter — Category", filters.filter_labels[1][1]],
      ["Filter — Status", filters.filter_labels[2][1]],
      ["Filter — Reason search", filters.filter_labels[3][1]],
      ["Total expenses", detail.total],
      ["Overall payments, as of " + detail.asOf, detail.payments],
      ["Balance due — overall, as of " + detail.asOf, detail.due],
      [],
      ["Category", "Total"]
    ];
    summaryRows.forEach(row => sheet.addRow(row));
    detail.categories.forEach(item => sheet.addRow([safeTextCell(categoryName(item)), categoryAmount(item)]));
    sheet.getColumn(2).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00';
    sheet.getRow(11).font = { bold: true };
    sheet.eachRow(row => row.eachCell(cell => {
      if (typeof cell.value === "string") cell.numFmt = "@";
    }));
    sheet.getColumn(2).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00';
    const expenses = workbook.addWorksheet("Expenses");
    expenses.columns = [
      { header: "Date", key: "date", width: 14 },
      { header: "Category", key: "category", width: 24 },
      { header: "Reason", key: "reason", width: 38 },
      { header: "Amount", key: "amount", width: 16, style: { numFmt: '"₹"#,##0.00;[Red]-"₹"#,##0.00' } },
      { header: "Status", key: "status", width: 14 },
      { header: "Claim number", key: "claim", width: 16 }
    ];
    payload.rows.forEach(row => {
      const out = expenses.addRow({
        date: excelDate(row.date),
        category: safeTextCell(row.category_name),
        reason: safeTextCell(row.reason),
        amount: Number(row.amount),
        status: safeTextCell(row.status),
        claim: row.claim_number === null || row.claim_number === undefined ? "" : safeTextCell(row.claim_number)
      });
      out.getCell(1).numFmt = "dd/mm/yyyy";
      [2, 3, 5, 6].forEach(i => { out.getCell(i).numFmt = "@"; });
    });
    const totalRow = expenses.addRow(["", "", "Total", detail.total, "", ""]);
    totalRow.font = { bold: true };
    totalRow.getCell(3).numFmt = "@";
    totalRow.getCell(4).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00';
    expenses.getRow(1).font = { bold: true };
    expenses.views = [{ state: "frozen", ySplit: 1 }];
    const buffer = await workbook.xlsx.writeBuffer();
    return new File([buffer], fileName(filters, "xlsx"), {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
  }
  async function buildPdf(payload, filters) {
    if (payload.rows.length > 2000) throw new Error("PDF is limited to 2,000 rows. Choose Excel for this export.");
    await loadLibrary("https://cdn.jsdelivr.net/npm/jspdf@3.0.4/dist/jspdf.umd.min.js", () => !!(window.jspdf && window.jspdf.jsPDF));
    await loadLibrary("https://cdn.jsdelivr.net/npm/jspdf-autotable@5.0.8/dist/jspdf.plugin.autotable.min.js", () => !!(window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API.autoTable));
    const summary = payload.summary;
    const detail = summaryDetails(summary, filters);
    const doc = new window.jspdf.jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    doc.setFontSize(14);
    doc.text("Expenses", 36, 32);
    doc.setFontSize(9);
    const info = [
      "Employee: " + detail.name,
      "Period: " + displayDates(detail.period),
      "Total: " + (detail.total === null ? "Unknown" : indianMoney(detail.total)),
      "Overall payments, as of " + displayDate(detail.asOf) + ": " + (typeof detail.payments === "number" ? indianMoney(detail.payments) : detail.payments),
      "Balance due — overall, as of " + displayDate(detail.asOf) + ": " + (typeof detail.due === "number" ? indianMoney(detail.due) : detail.due),
      "Filters: " + filters.filter_labels.map(pair => pair[0] + "=" + displayDates(pair[1])).join("; ")
    ];
    const infoLines = info.flatMap(line => doc.splitTextToSize(line, doc.internal.pageSize.getWidth() - 72));
    doc.text(infoLines, 36, 50);
    const infoEndY = 50 + infoLines.length * 11;
    const categoryRows = detail.categories.map(item => [categoryName(item), categoryAmount(item) === null ? "Unknown" : indianMoney(categoryAmount(item))]);
    if (categoryRows.length) {
      doc.autoTable({
        startY: infoEndY + 20,
        margin: { bottom: 30 },
        head: [["Category", "Total"]],
        body: categoryRows,
        theme: "grid",
        styles: { fontSize: 8 }
      });
    }
    const rowsStart = Math.max(infoEndY + 20, (doc.lastAutoTable?.finalY || infoEndY) + 14);
    doc.autoTable({
      startY: rowsStart,
      margin: { bottom: 30 },
      head: [["Date", "Category", "Reason", "Amount (Rs.)", "Status", "Claim number"]],
      body: payload.rows.map(row => [
        displayDate(row.date), text(row.category_name), text(row.reason),
        indianMoney(Number(row.amount)).replace(/^Rs\. /, ""), text(row.status), text(row.claim_number)
      ]),
      foot: [["", "", "Total (server)", detail.total === null ? "Unknown" : indianMoney(detail.total).replace(/^Rs\. /, ""), "", ""]],
      showFoot: "last",
      theme: "grid",
      styles: { fontSize: 7, overflow: "linebreak", cellPadding: 3 },
      columnStyles: { 2: { cellWidth: 190 } }
    });
    const pageCount = doc.getNumberOfPages();
    const pageHeight = doc.internal.pageSize.getHeight();
    for (let page = 1; page <= pageCount; page++) {
      doc.setPage(page);
      doc.setFontSize(8);
      doc.text("Page " + page + " of " + pageCount, doc.internal.pageSize.getWidth() / 2, pageHeight - 14, { align: "center" });
    }
    return new File([doc.output("blob")], fileName(filters, "pdf"), { type: "application/pdf" });
  }
  async function prepareFile() {
    if (state.busy) return;
    hideFileActions();
    setBusy(true);
    const filters = currentFilters();
    try {
      if (filters.from_date && filters.to_date && filters.from_date > filters.to_date) {
        throw new Error("Start date must be on or before end date.");
      }
      show("Preparing export…");
      const payload = await fetchExport(filters);
      const type = $("expenseExportType").value;
      const file = type === "pdf" ? await buildPdf(payload, filters) : await buildExcel(payload, filters);
      setFile(file, file.name);
      show("File prepared. Notes are not included because export_rows does not return them. Tap Share or Download.");
    } catch (e) {
      show((e && e.message ? e.message : "Export failed.") + " The expense list and Add Expense are separate and remain available.");
    } finally {
      setBusy(false);
    }
  }
  prepare.addEventListener("click", () => void prepareFile());
  share.addEventListener("click", () => {
    if (!state.file) return;
    if (typeof navigator.share !== "function" || typeof File === "undefined") {
      show("Phone share sheet is not supported here. Tap Download instead.");
      return;
    }
    if (navigator.canShare && !navigator.canShare({ files: [state.file] })) {
      show("Phone share sheet cannot share this file here. Tap Download instead.");
      return;
    }
    // Invoke the native share sheet directly from this user tap.
    navigator.share({ files: [state.file], title: state.fileName })
      .then(() => show("Share sheet completed."))
      .catch(error => {
        if (error && error.name === "AbortError") show("Sharing cancelled. Your prepared file is still available.");
        else show("Sharing failed. Tap Download instead.");
      });
  });
  download.addEventListener("click", () => {
    if (!state.file) return;
    const url = URL.createObjectURL(state.file);
    const a = document.createElement("a");
    a.href = url;
    a.download = state.fileName;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    show("Download requested.");
  });
  if (controls) controls.addEventListener("click", event => event.stopPropagation());
})();