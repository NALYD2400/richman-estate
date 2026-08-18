/**
 * ==========================================================================
 * Richman Estate — Luxury Invoice & Billing System (Screen & A4 PDF Print)
 * ==========================================================================
 */

import { escapeHTML } from "../core/sanitize";
import { supabaseClient } from "../core/supabase";
import { showToast } from "./02-admin-crud";

export interface InvoiceData {
  invoiceNumber: string;
  invoiceDate: string;
  clientName: string;
  clientPhone: string;
  discordId: string;
  itemName: string;
  itemType: 'vehicle' | 'suite';
  itemPlate?: string;
  dates: string;
  duration: number;
  durationUnit: string;
  unitPrice: number;
  subTotal: number;
  deposit: number;
  totalAmount: number;
  status: 'confirmed' | 'pending' | 'cancelled' | 'completed' | 'closed';
  bookingId: string;
}

export function parsePriceNumber(raw: any): number {
  if (typeof raw === 'number') return raw;
  if (!raw) return 0;
  const cleaned = String(raw).replace(/[^0-9]/g, '');
  return parseInt(cleaned, 10) || 0;
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('fr-FR').format(amount) + ' $';
}

export function buildInvoiceData(booking: any): InvoiceData {
  const bId = String(booking.id || '').trim();
  const shortRef = bId ? bId.slice(0, 6).toUpperCase() : Math.random().toString(36).slice(2, 8).toUpperCase();
  const createdDate = booking.created_at ? new Date(booking.created_at) : new Date();
  const year = createdDate.getFullYear();
  const invoiceNumber = `FAC-${year}-${shortRef}`;
  
  const isSuite = booking.type === 'suite' || booking.type === 'appartement' || booking.type === 'chambre';
  const duration = parseInt(String(booking.duration || '1'), 10) || 1;
  const durationUnit = isSuite ? (duration > 1 ? 'nuits' : 'nuit') : (duration > 1 ? 'jours' : 'jour');
  
  const rawTotal = parsePriceNumber(booking.amount || booking.total_price || booking.price || 0);
  const totalAmount = rawTotal > 0 ? rawTotal : 50000;
  const unitPrice = Math.round(totalAmount / Math.max(1, duration));
  const deposit = Math.round(totalAmount * 0.1); // Caution de sécurité (10%)
  const subTotal = totalAmount;

  // Extract license plate / room number
  let itemPlate = booking.plate || booking.item_plate || '';
  if (!itemPlate && booking.specs) {
    try {
      if (typeof booking.specs === 'string' && booking.specs.startsWith('{')) {
        const meta = JSON.parse(booking.specs);
        itemPlate = meta.plate || '';
      } else if (typeof booking.specs === 'string' && !booking.specs.startsWith('{')) {
        itemPlate = booking.specs;
      }
    } catch (e) {}
  }
  if (!itemPlate && !isSuite) {
    itemPlate = 'LXS-RICH-RP';
  }

  return {
    invoiceNumber,
    invoiceDate: createdDate.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }),
    clientName: booking.client_name || booking.user_name || 'Citoyen RP',
    clientPhone: booking.phone || booking.client_phone || 'Non renseigné',
    discordId: booking.discord_id || '',
    itemName: booking.item_name || booking.vehicle_name || booking.suite_name || (isSuite ? 'Hébergement de Prestige' : 'Supercar de Prestige'),
    itemType: isSuite ? 'suite' : 'vehicle',
    itemPlate,
    dates: booking.dates || 'Location Immédiate',
    duration,
    durationUnit,
    unitPrice,
    subTotal,
    deposit,
    totalAmount,
    status: (booking.status === 'completed' || booking.status === 'closed')
      ? 'completed'
      : (booking.status === 'confirmed' ? 'confirmed' : (booking.status === 'cancelled' ? 'cancelled' : 'pending')),
    bookingId: bId
  };
}

export function renderInvoiceHTML(inv: InvoiceData): string {
  const statusStamp = inv.status === 'completed'
    ? '<div class="invoice-stamp"><i class="fa-solid fa-circle-check"></i> RESTITUÉ &amp; CLÔTURÉ</div>'
    : (inv.status === 'confirmed'
        ? '<div class="invoice-stamp"><i class="fa-solid fa-circle-check"></i> EN COURS &amp; CERTIFIÉ</div>'
        : (inv.status === 'cancelled'
            ? '<div class="invoice-stamp cancelled"><i class="fa-solid fa-circle-xmark"></i> ANNULÉ / REMBOURSÉ</div>'
            : '<div class="invoice-stamp pending"><i class="fa-solid fa-clock"></i> EN ATTENTE DE RÈGLEMENT</div>'));

  return `
    <div class="invoice-top-actions">
      <div class="invoice-top-title">
        <i class="fa-solid fa-file-invoice-dollar"></i>
        <span>Facture Officielle • ${escapeHTML(inv.invoiceNumber)}</span>
      </div>
      <div class="invoice-actions-btns">
        <button type="button" class="btn-invoice-print" onclick="window.printInvoice()">
          <i class="fa-solid fa-print"></i> Imprimer / Enregistrer PDF
        </button>
        <button type="button" class="btn-invoice-close" onclick="window.closeInvoiceModal()" aria-label="Fermer">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    </div>

    <div class="invoice-paper" id="printable-invoice">
      <!-- Paper Header -->
      <div class="invoice-paper-header">
        <div class="invoice-brand">
          <img src="assets/logo.webp" alt="Richman Estate" class="invoice-logo" />
          <div class="invoice-brand-text">
            <h3>Richman Estate</h3>
            <span>Flotte Automobile &amp; Résidences VIP</span>
          </div>
        </div>
        <div class="invoice-meta-top">
          <div class="invoice-number-badge">${escapeHTML(inv.invoiceNumber)}</div>
          <div class="invoice-date">Émise le ${escapeHTML(inv.invoiceDate)}</div>
        </div>
      </div>

      <!-- Parties Grid -->
      <div class="invoice-parties-grid">
        <div>
          <div class="invoice-party-title">Émetteur</div>
          <div class="invoice-party-content">
            <strong>Richman Estate</strong><br />
            Domaine de Richman, Los Santos<br />
            San Andreas<br />
            <em>Flotte Automobile &amp; Résidences VIP</em>
          </div>
        </div>
        <div>
          <div class="invoice-party-title">Facturé à</div>
          <div class="invoice-party-content">
            <strong>${escapeHTML(inv.clientName)}</strong><br />
            Téléphone : ${escapeHTML(inv.clientPhone)}<br />
            ${inv.discordId ? `Identifiant : <span style="color:#818cf8;">@${escapeHTML(inv.discordId)}</span><br />` : ''}
            Dossier Réf : <code style="color:#c5a880;">#${escapeHTML(inv.bookingId.slice(0, 6).toUpperCase() || 'REF')}</code>
          </div>
        </div>
      </div>

      <!-- Items Table -->
      <table class="invoice-items-table">
        <thead>
          <tr>
            <th>Prestation &amp; Description</th>
            <th style="text-align: center;">Durée</th>
            <th style="text-align: right;">Tarif Unitaire</th>
            <th style="text-align: right;">Total Net</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <div class="invoice-item-desc">
                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                  <strong>${inv.itemType === 'suite' ? '🏨 ' : '🏎️ '}${escapeHTML(inv.itemName)}</strong>
                  ${inv.itemPlate ? `<span class="invoice-plate-badge" style="font-family: monospace; font-size: 11px; font-weight: 700; background: rgba(255, 255, 255, 0.08); color: #ffffff; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 4px; padding: 2px 7px; letter-spacing: 0.06em; text-transform: uppercase;">🔢 ${escapeHTML(inv.itemPlate)}</span>` : ''}
                </div>
                <span>Période réservée : ${escapeHTML(inv.dates)}</span>
              </div>
            </td>
            <td style="text-align: center;">
              <strong>${inv.duration}</strong> ${escapeHTML(inv.durationUnit)}
            </td>
            <td style="text-align: right; font-family: monospace;">
              ${formatCurrency(inv.unitPrice)}
            </td>
            <td style="text-align: right; font-family: monospace; font-weight: 700; color: #ffffff;">
              ${formatCurrency(inv.subTotal)}
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Totals & Certification -->
      <div class="invoice-totals-wrap">
        <div class="invoice-stamp-container">
          ${statusStamp}
        </div>

        <div class="invoice-totals-table" style="width: 320px;">
          <div class="invoice-total-row">
            <span>Montant Location HT :</span>
            <span style="font-family: monospace;">${formatCurrency(inv.subTotal)}</span>
          </div>
          <div class="invoice-total-row">
            <span>Taxes &amp; Frais de dossier (0%) :</span>
            <span style="font-family: monospace;">0 $</span>
          </div>
          <div class="invoice-total-row grand-total">
            <span>Total Règlement :</span>
            <span style="font-family: monospace;">${formatCurrency(inv.totalAmount)}</span>
          </div>
          <div class="invoice-total-row" style="margin-top: 6px; padding-top: 6px; border-top: 1px dashed rgba(255,255,255,0.1); font-size: 11px; color: #a1a1aa; display: flex; justify-content: space-between;">
            <span><i class="fa-solid fa-shield-halved" style="color: #c5a880; margin-right: 4px;"></i> Caution Garantie (10%) :</span>
            <span style="font-family: monospace; color: #d4d4d8;">${formatCurrency(inv.deposit)} <em>(Empreinte restituée)</em></span>
          </div>
        </div>
      </div>

      <!-- Legal Footer -->
      <div class="invoice-legal-footer">
        Document officiel émis par Richman Estate. Tout contrat de location ou de séjour implique l'acceptation intégrale du règlement intérieur du Domaine.
        Signature et validation électronique certifiées conformes sur le réseau sécurisé Los Santos RP.
      </div>
    </div>
  `;
}

export async function openInvoiceModal(bookingOrId: any) {
  let bookingData: any = bookingOrId;

  if (typeof bookingOrId === 'string') {
    if (supabaseClient) {
      showToast("Génération de la facture en cours...", "info");
      const { data, error } = await supabaseClient
        .from('bookings')
        .select('*')
        .eq('id', bookingOrId)
        .single();
      if (error || !data) {
        showToast("Impossible de charger le dossier pour la facture", "danger");
        return;
      }
      bookingData = data;
    } else {
      showToast("Base de données indisponible", "danger");
      return;
    }
  }

  if (!bookingData) {
    showToast("Données de réservation invalides", "danger");
    return;
  }

  // Lookup vehicle plate from database if not set in booking
  const isSuite = bookingData.type === 'suite' || bookingData.type === 'appartement' || bookingData.type === 'chambre';
  if (!bookingData.plate && !isSuite && supabaseClient) {
    try {
      let vQuery = supabaseClient.from('vehicules').select('specs, name');
      if (bookingData.vehicle_id) {
        vQuery = vQuery.eq('id', bookingData.vehicle_id);
      } else if (bookingData.item_name) {
        vQuery = vQuery.ilike('name', `%${bookingData.item_name}%`);
      }
      const { data: vData } = await vQuery.limit(1).maybeSingle();
      if (vData && vData.specs) {
        try {
          if (typeof vData.specs === 'string' && vData.specs.startsWith('{')) {
            const meta = JSON.parse(vData.specs);
            bookingData.plate = meta.plate || '';
          } else {
            bookingData.plate = vData.specs;
          }
        } catch (e) {}
      }
    } catch (e) {}
  }

  if (!bookingData) {
    showToast("Données de réservation invalides", "danger");
    return;
  }

  const invoice = buildInvoiceData(bookingData);
  let overlay = document.getElementById('invoice-modal-overlay');

  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'luxury-invoice-modal-overlay';
    overlay.id = 'invoice-modal-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `<div class="luxury-invoice-modal-container" id="invoice-modal-content"></div>`;
    document.body.appendChild(overlay);
  }

  const container = overlay.querySelector('.luxury-invoice-modal-container');
  if (container) {
    container.innerHTML = renderInvoiceHTML(invoice);
  }

  overlay.classList.add('active');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('menu-open');

  overlay.onclick = (e) => {
    if (e.target === overlay) {
      closeInvoiceModal();
    }
  };
}

export function closeInvoiceModal() {
  const overlay = document.getElementById('invoice-modal-overlay');
  if (overlay) {
    overlay.classList.remove('active');
    overlay.setAttribute('aria-hidden', 'true');
  }
  document.body.classList.remove('menu-open');
}

export function printInvoice() {
  window.print();
}

// Global hooks
(window as any).openInvoiceModal = openInvoiceModal;
(window as any).closeInvoiceModal = closeInvoiceModal;
(window as any).printInvoice = printInvoice;
