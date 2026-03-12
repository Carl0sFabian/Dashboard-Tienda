const CONFIG_KEY = "dashboard_config_v1";
const DATA_KEY = "dashboard_data_v1";

const DEFAULT_DATA = { orders: [], clients: [], expenses: [] };

const state = {
    data: structuredClone(DEFAULT_DATA),
    endpoint: "",
    source: "local",
};

// --- UTILITARIOS ---
function structuredClone(obj) { return JSON.parse(JSON.stringify(obj)); }

function formatCurrency(value) {
    return new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN", maximumFractionDigits: 0 }).format(Number(value || 0));
}

function formatDate(dateISO) {
    if (!dateISO) return "-";
    const [year, month, day] = dateISO.split("-");
    return `${day}/${month}/${year}`;
}

function orderTotal(order) {
    const savedTotal = Number(order.total);
    if (Number.isFinite(savedTotal) && savedTotal > 0) {
        return savedTotal;
    }

    const qty = Number(order.quantity || 0) || Number(order.carnets || 0) + Number(order.labels || 0);
    const customUnitPrice = Number(order.unitPrice);
    if (qty > 0 && Number.isFinite(customUnitPrice) && customUnitPrice > 0) {
        return qty * customUnitPrice;
    }

    return Number(order.carnets || 0) * 5000 + Number(order.labels || 0) * 500;
}

function uid(prefix) { return `${prefix}${Math.random().toString(36).slice(2, 9)}`; }

// --- PERSISTENCIA Y API ---
function getConfig() { return JSON.parse(localStorage.getItem(CONFIG_KEY)) || { endpoint: "" }; }
function saveConfig(config) { localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); }
function loadLocalData() { return JSON.parse(localStorage.getItem(DATA_KEY)) || structuredClone(DEFAULT_DATA); }
function saveLocalData(data) { localStorage.setItem(DATA_KEY, JSON.stringify(data)); }

async function callEndpoint(action, payload) {
    if (!state.endpoint) return;
    // Usamos mode: 'no-cors' para el POST de guardado
    await fetch(state.endpoint, {
        method: "POST",
        mode: "no-cors",
        body: JSON.stringify({ action, payload }),
    });
    return { ok: true };
}

async function loadData() {
    const config = getConfig();
    state.endpoint = config.endpoint || "";
    state.data = loadLocalData();

    if (state.endpoint) {
        try {
            // Agregamos 'redirect: "follow"' para que el navegador siga la ruta de Google
            const response = await fetch(state.endpoint, {
                method: 'GET',
                redirect: 'follow',
                headers: {
                    'Content-Type': 'text/plain;charset=utf-8',
                }
            });

            if (!response.ok) throw new Error("Error en la red");

            const result = await response.json();
            if (result.ok && result.data) {
                state.data = result.data;
                state.source = "google-sheets";
                saveLocalData(state.data);
                console.log("✅ Sincronización exitosa con Sheets");
                routeRender();
            }
        } catch (e) {
            console.warn("⚠️ Usando caché local:", e.message);
            state.source = "local";
            routeRender(); // Renderizamos lo que tengamos localmente
        }
    } else {
        routeRender();
    }
}

async function persistData() {
    saveLocalData(state.data);
    if (state.endpoint) {
        await callEndpoint("saveAllData", { data: state.data });
    }
}

// --- NOTIFICACIONES ---
function notify(message) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    document.body.appendChild(toast);
    // Delay ensures the browser paints opacity:0 before the transition to show fires
    setTimeout(() => toast.classList.add("show"), 10);
    setTimeout(() => { toast.classList.remove("show"); setTimeout(() => toast.remove(), 300); }, 3000);
}

// --- RENDERIZADO ---
function routeRender() {
    const page = document.body.dataset.page;
    if (page === "dashboard") renderDashboard();
    if (page === "pedidos") renderOrders();
    if (page === "clientes") renderClients();
}

function renderDashboard() {
    const totalIncome = state.data.orders.reduce((acc, o) => acc + orderTotal(o), 0);
    const totalExpenses = state.data.expenses.reduce((acc, e) => acc + Number(e.amount || 0), 0);
    const totalOrders = state.data.orders.length;
    const pendingOrders = state.data.orders.filter(o => o.status === "Pendiente").length;

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set("kpi-ingresos", formatCurrency(totalIncome));
    set("kpi-gastos", formatCurrency(totalExpenses));
    set("kpi-ganancia", formatCurrency(totalIncome - totalExpenses));
    set("kpi-pedidos", totalOrders);
    set("kpi-pedidos-delta", `${pendingOrders} pendiente${pendingOrders !== 1 ? "s" : ""}`);

    const expenseList = document.getElementById("dashboard-expenses");
    if (expenseList) {
        const latest = [...state.data.expenses].slice(-5).reverse();
        expenseList.innerHTML = latest.length
            ? latest.map(e => `
                <div class="expense-row">
                    <div><strong>${e.concept || e.category}</strong><small>${formatDate(e.date)}</small></div>
                    <b>${formatCurrency(e.amount)}</b>
                </div>`).join("")
            : `<p style="color:var(--muted);padding:10px 0;">Sin gastos registrados</p>`;
    }
}

function renderOrders() {
    const tbody = document.getElementById("orders-tbody");
    if (!tbody) return;

    const searchVal = (document.getElementById("order-search")?.value || "").toLowerCase();
    const statusFilter = document.getElementById("order-filter")?.value || "";

    const filtered = state.data.orders.filter(o => {
        const matchText = !searchVal ||
            (o.childName || "").toLowerCase().includes(searchVal) ||
            (o.phone || "").includes(searchVal);
        const matchStatus = !statusFilter || statusFilter === "Filtrar" || o.status === statusFilter;
        return matchText && matchStatus;
    });

    const statusOptions = (current) => ["Pendiente", "Completado", "Entregado"]
        .map(s => `<option value="${s}" ${current === s ? "selected" : ""}>${s}</option>`)
        .join("");

    tbody.innerHTML = filtered.map(o => `
        <tr>
                    <td data-label="Fecha">${formatDate(o.date)}</td>
                    <td data-label="Nombre del Niño/a"><strong>${o.childName}</strong></td>
                    <td data-label="Celular">${o.phone}</td>
                    <td data-label="Carnets"><span class="inline-pill pill-v">${o.carnets}</span></td>
                    <td data-label="Etiquetas"><span class="inline-pill pill-p">${o.labels}</span></td>
                    <td data-label="Total" class="money-green">${formatCurrency(orderTotal(o))}</td>
                    <td data-label="Estado">
                        <select class="status-select" onchange="updateOrderStatus('${o.id}', this.value)">
                            ${statusOptions(o.status)}
                        </select>
                    </td>
                    <td data-label="Acciones" class="td-actions">
            <button class="icon-btn danger" title="Eliminar" onclick="deleteOrder('${o.id}')"><i class="bi bi-trash"></i></button>
          </td>
        </tr>
    `).join("") || `<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:20px;">Sin pedidos registrados</td></tr>`;

    const totalCount = state.data.orders.length;
    const totalIncome = state.data.orders.reduce((acc, o) => acc + orderTotal(o), 0);
    const avg = totalCount ? Math.round(totalIncome / totalCount) : 0;
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set("orders-total-count", totalCount);
    set("orders-total-income", formatCurrency(totalIncome));
    set("orders-average", formatCurrency(avg));
}

function renderClients() {
        const grid = document.getElementById("clients-grid");
        if (!grid) return;

        const query = (document.getElementById("client-search")?.value || "").toLowerCase();
        const filtered = state.data.clients.filter(c =>
                !query || c.name.toLowerCase().includes(query) || (c.linkedChild || "").toLowerCase().includes(query)
        );

        const clientOrders = (c) => state.data.orders.filter(o => o.childName === c.linkedChild);

        grid.innerHTML = filtered.map(c => {
                const orders = clientOrders(c);
                const totalSpent = orders.reduce((acc, o) => acc + orderTotal(o), 0);
                return `
                <article class="card client-card">
                    <div class="client-head">
                        <div class="avatar">${c.name.charAt(0).toUpperCase()}</div>
                        <div>
                            <h3>${c.name}</h3>
                            <p style="font-size:13px;color:var(--muted);margin-top:2px;">${c.phone || ""}</p>
                        </div>
                    </div>
                    <div class="linked">
                        <p class="small-title">NIÑO/A</p>
                        <h4>${c.linkedChild || "-"}</h4>
                    </div>
                    <div class="stats-row">
                        <div class="stat-box blue">
                            <p style="font-size:11px;font-weight:700;">PEDIDOS</p>
                            <p style="font-size:20px;font-weight:800;">${orders.length}</p>
                        </div>
                        <div class="stat-box green">
                            <p style="font-size:11px;font-weight:700;">TOTAL</p>
                            <p style="font-size:16px;font-weight:800;">${formatCurrency(totalSpent)}</p>
                        </div>
                    </div>
                    <div class="card-actions" style="grid-template-columns:1fr;">
                        <button class="btn btn-danger-soft" onclick="deleteClient('${c.id}')"><i class="bi bi-trash"></i> Eliminar</button>
                    </div>
                </article>`;
        }).join("") || `<p style="grid-column:1/-1;padding:20px;color:var(--muted);">Sin clientes registrados</p>`;

        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        set("clients-total", state.data.clients.length);
        set("clients-orders", state.data.orders.length);
        set("clients-income", formatCurrency(state.data.orders.reduce((acc, o) => acc + orderTotal(o), 0)));
}

// --- ACCIONES ---
window.deleteOrder = async (id) => {
    state.data.orders = state.data.orders.filter(o => o.id !== id);
    await persistData();
    renderOrders();
};

window.deleteClient = async (id) => {
    state.data.clients = state.data.clients.filter(c => c.id !== id);
    await persistData();
    renderClients();
};

window.updateOrderStatus = async (id, status) => {
    const order = state.data.orders.find(o => o.id === id);
    if (!order) return;
    order.status = status;
    await persistData();
    renderOrders();
    renderDashboard();
};

// --- FORMULARIOS ---
window.cycleOrderStatus = async (id) => {
    const order = state.data.orders.find(o => o.id === id);
    if (!order) return;
    const cycle = { "Pendiente": "Completado", "Completado": "Entregado", "Entregado": "Pendiente" };
    order.status = cycle[order.status] || "Pendiente";
    await persistData();
    renderOrders();
};

function setupClients() {
    const btnShowForm = document.getElementById("btn-show-client-form");
    const btnHideForm = document.getElementById("btn-hide-client-form");
    const formCard = document.getElementById("client-form-card");
    const clientForm = document.getElementById("client-form");

    if (btnShowForm && formCard) {
        btnShowForm.addEventListener("click", () => {
            formCard.style.display = "block";
            btnShowForm.style.display = "none";
        });
    }

    if (btnHideForm && formCard) {
        btnHideForm.addEventListener("click", () => {
            formCard.style.display = "none";
            if (btnShowForm) btnShowForm.style.display = "flex";
        });
    }

    if (clientForm) {
        clientForm.addEventListener("submit", async (e) => {
            e.preventDefault();

            const newClient = {
                id: uid("c"),
                name: document.getElementById("client-name").value,
                phone: document.getElementById("client-phone").value,
                linkedChild: document.getElementById("client-linked-child").value
            };

            // Guardamos en el estado global
            state.data.clients.push(newClient);

            // Persistimos en LocalStorage y Google Sheets
            await persistData();

            notify("Cliente guardado correctamente");

            // Limpiamos y ocultamos
            clientForm.reset();
            formCard.style.display = "none";
            if (btnShowForm) btnShowForm.style.display = "flex";

            renderClients();
        });
    }
}

function setupOrderForm() {
    const form = document.getElementById("order-form");
    if (!form) return;

    const PRICES = { carnets: 5000, etiquetas: 500 };
    let type = "carnets";
    const unitPriceInput = document.getElementById("order-unit-price");

    function syncProductMode() {
        const card = document.getElementById("order-product-card");
        const titleEl = document.getElementById("order-product-title");
        if (card) {
            card.classList.remove("mode-etiquetas");
            if (type === "etiquetas") card.classList.add("mode-etiquetas");
        }
        if (titleEl) titleEl.textContent = type === "carnets" ? "Carnets del Colegio" : "Etiquetas Personalizadas";
        if (unitPriceInput) unitPriceInput.value = String(PRICES[type]);
        updateTotal();
    }

    function updateTotal() {
        const qty = Math.max(0, Number(document.getElementById("order-quantity")?.value || 0));
        const unitPrice = Math.max(0, Number(unitPriceInput?.value || 0));
        const subtotal = qty * unitPrice;
        const subtotalEl = document.getElementById("order-subtotal");
        const totalEl = document.getElementById("order-total");
        if (subtotalEl) subtotalEl.value = formatCurrency(subtotal);
        if (totalEl) totalEl.textContent = formatCurrency(subtotal);
    }

    document.querySelectorAll("[data-product-type]").forEach(opt => opt.addEventListener("click", (e) => {
        document.querySelectorAll("[data-product-type]").forEach(o => o.classList.remove("selected"));
        e.currentTarget.classList.add("selected");
        type = e.currentTarget.dataset.productType;
        syncProductMode();
    }));

    const qtyInput = document.getElementById("order-quantity");
    if (qtyInput) qtyInput.addEventListener("input", updateTotal);
    if (unitPriceInput) unitPriceInput.addEventListener("input", updateTotal);

    const cancelBtn = document.getElementById("order-cancel");
    if (cancelBtn) cancelBtn.addEventListener("click", () => window.location.href = "pedidos.html");

    // Select carnets by default
    const firstOption = document.querySelector("[data-product-type='carnets']");
    if (firstOption) firstOption.classList.add("selected");
    syncProductMode();

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const qty = Number(document.getElementById("order-quantity").value);
        const unitPrice = Number(unitPriceInput?.value || 0);
        const total = qty * unitPrice;
        if (qty <= 0) { notify("Ingresa una cantidad mayor a 0"); return; }
        if (unitPrice <= 0) { notify("Ingresa un precio unitario mayor a 0"); return; }
        state.data.orders.push({
            id: uid("o"),
            date: new Date().toISOString().split('T')[0],
            childName: document.getElementById("order-child").value,
            phone: document.getElementById("order-phone").value,
            carnets: type === "carnets" ? qty : 0,
            labels: type === "etiquetas" ? qty : 0,
            quantity: qty,
            unitPrice,
            total,
            productType: type,
            status: "Pendiente",
            clientName: document.getElementById("order-child").value
        });
        await persistData();
        notify("Pedido guardado correctamente");
        window.location.href = "pedidos.html";
    });
}

function setupExpenseForm() {
    const btn = document.getElementById("expense-submit");
    if (!btn) return;

    const amountInput = document.getElementById("expense-amount");
    const totalEl = document.getElementById("expense-total");
    if (amountInput && totalEl) {
        amountInput.addEventListener("input", () => {
            totalEl.textContent = formatCurrency(Number(amountInput.value) || 0);
        });
    }

    const cancelBtn = document.getElementById("expense-cancel");
    if (cancelBtn) cancelBtn.addEventListener("click", () => window.location.href = "index.html");

    btn.addEventListener("click", async () => {
        const date = document.getElementById("expense-date").value;
        const category = document.getElementById("expense-category").value;
        const concept = document.getElementById("expense-concept").value;
        const amount = Number(document.getElementById("expense-amount").value);
        if (!date || !concept || !amount) { notify("Completa todos los campos requeridos"); return; }
        if (category === "Selecciona categoría") { notify("Selecciona una categoría"); return; }
        state.data.expenses.push({ id: uid("e"), date, category, concept, amount });
        await persistData();
        notify("Gasto registrado correctamente");
        window.location.href = "index.html";
    });
}

// --- INICIO ---
async function init() {
    await loadData();
    const page = document.body.dataset.page;
    if (page === "nuevo-pedido") setupOrderForm();
    if (page === "nuevo-gasto") setupExpenseForm();
    if (page === "clientes") {
        setupClients();
        const searchInput = document.getElementById("client-search");
        if (searchInput) searchInput.addEventListener("input", renderClients);
    }
    if (page === "pedidos") {
        const searchInput = document.getElementById("order-search");
        const filterSelect = document.getElementById("order-filter");
        if (searchInput) searchInput.addEventListener("input", renderOrders);
        if (filterSelect) filterSelect.addEventListener("change", renderOrders);
    }
    if (window.location.search.includes("sync=1")) {
        const url = prompt("Introduce la URL de tu Google Apps Script:");
        if (url) { saveConfig({ endpoint: url }); location.reload(); }
    }
}

document.addEventListener("DOMContentLoaded", init);