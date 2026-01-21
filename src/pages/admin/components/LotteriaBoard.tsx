import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../../supabaseClient';
import { useAdminRole } from '../../../hooks/useAdminRole';
import NewClientModal from './NewClientModal';

// Generate UUID for ticket
function generateTicketUuid(ticketNumber: number): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  return `manual-${ticketNumber}-${timestamp}-${random}`;
}

// Send WhatsApp notification to admin
async function sendWhatsAppNotification(ticketNumbers: number[], fullName: string, email: string, phone: string): Promise<{ success: boolean; error?: string }> {
  try {
    const ticketList = ticketNumbers.map(n => `#${String(n).padStart(4, '0')}`).join(', ');

    console.log('[WhatsApp] Sending notification for tickets:', ticketList);

    const response = await fetch('/.netlify/functions/send-whatsapp-notification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'lottery_ticket',
        ticketNumbers,
        customerInfo: { fullName, email, phone }
      })
    });

    console.log('[WhatsApp] Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[WhatsApp] Error response:', errorText);
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    const result = await response.json();
    console.log('[WhatsApp] Success:', result);

    if (result.success) {
      return { success: true };
    } else {
      return { success: false, error: result.message || 'Unknown error' };
    }
  } catch (error: any) {
    console.error('[WhatsApp] Exception:', error);
    return { success: false, error: error.message || 'Network error' };
  }
}

interface Ticket {
  ticket_number: number;
  email: string;
  full_name: string;
  customer_phone?: string;
  purchase_date: string;
  payment_intent_id: string;
  user_id?: string;
  // All possible customer fields that might be in the database
  customer_data?: {
    tipo_cliente?: string;
    nome?: string;
    cognome?: string;
    data_nascita?: string;
    luogo_nascita?: string;
    indirizzo?: string;
    citta?: string;
    cap?: string;
    provincia?: string;
    codice_fiscale?: string;
    telefono?: string;
    ragione_sociale?: string;
    denominazione?: string;
    partita_iva?: string;
    pec?: string;
    codice_sdi?: string;
    ente_ufficio?: string;
  };
}

// Simple Payment Method Selection Modal
interface PaymentMethodModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (paymentMethod: string) => void;
  ticketCount: number;
}

const PaymentMethodModal: React.FC<PaymentMethodModalProps> = ({ isOpen, onClose, onConfirm, ticketCount }) => {
  const [paymentMethod, setPaymentMethod] = useState('Contanti');

  // Calculate discounted price
  const calculateTotalPrice = (qty: number): number => {
    if (qty < 10) return qty * 25;
    else if (qty >= 10 && qty < 100) return qty * 22;
    else if (qty === 100) return 1999;
    else return qty * 20;
  };

  const totalPrice = calculateTotalPrice(ticketCount);
  const originalPrice = ticketCount * 25;
  const discount = originalPrice - totalPrice;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-theme-bg-primary bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-96">
        <h3 className="text-xl font-bold mb-4">
          Seleziona Metodo di Pagamento
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          {ticketCount} bigliett{ticketCount > 1 ? 'i' : 'o'}
        </p>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Metodo di Pagamento</label>
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            className="w-full border rounded px-3 py-2"
            required
          >
            <option value="Contanti">Contanti</option>
            <option value="Carta">Carta</option>
            <option value="Bonifico">Bonifico</option>
            <option value="Paypal">Paypal</option>
          </select>
        </div>

        {discount > 0 && (
          <div className="mb-4 p-3 bg-yellow-50 border border-yellow-300 rounded">
            <p className="text-sm font-semibold text-yellow-800 mb-1">Sconto applicato!</p>
            <p className="text-xs text-yellow-700">
              Prezzo originale: €{originalPrice.toFixed(2)}
            </p>
            <p className="text-xs text-yellow-700">
              Sconto: -€{discount.toFixed(2)}
            </p>
            <p className="text-sm font-bold text-yellow-900 mt-1">
              Totale: €{totalPrice.toFixed(2)}
            </p>
          </div>
        )}
        {discount === 0 && (
          <div className="mb-4 p-3 bg-gray-100 rounded">
            <p className="text-sm font-bold text-gray-900">
              Totale: €{totalPrice.toFixed(2)}
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-300 rounded-full hover:bg-gray-400"
          >
            Annulla
          </button>
          <button
            onClick={() => onConfirm(paymentMethod)}
            className="px-4 py-2 bg-blue-600 text-theme-text-primary rounded-full hover:bg-blue-700"
          >
            Conferma Vendita
          </button>
        </div>
      </div>
    </div>
  );
};

interface ManualSaleModalProps {
  ticketNumber?: number;
  ticketNumbers?: number[];
  onClose: () => void;
  onConfirm: (ticketNumbers: number[], email: string, fullName: string, phone: string, paymentMethod: string) => void;
  onOpenNewClientModal: () => void;
}

interface Customer {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  tipo_cliente?: string;
  nome?: string;
  cognome?: string;
  ragione_sociale?: string;
  denominazione?: string;
  ente_ufficio?: string;
  telefono?: string;
}

const ManualSaleModal: React.FC<ManualSaleModalProps & { prefillData?: { email: string; fullName: string; phone: string } | null }> = ({ ticketNumber, ticketNumbers, onClose, onConfirm, onOpenNewClientModal, prefillData }) => {
  const [email, setEmail] = useState(prefillData?.email || '');
  const [fullName, setFullName] = useState(prefillData?.fullName || '');
  const [phone, setPhone] = useState(prefillData?.phone || '');
  const [paymentMethod, setPaymentMethod] = useState('Contanti');
  const [searchTerm, setSearchTerm] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [filteredCustomers, setFilteredCustomers] = useState<Customer[]>([]);
  const [showClientSelector, setShowClientSelector] = useState(true);

  const tickets = ticketNumbers || (ticketNumber ? [ticketNumber] : []);
  const isBulkSale = tickets.length > 1;

  // Load customers on mount - same logic as CustomersTab
  useEffect(() => {
    const loadCustomers = async () => {
      console.log('[ManualSaleModal] Loading customers...');

      const customerMap = new Map<string, Customer>();

      // Get unique customers from bookings table
      const { data: bookingsData, error: bookingsError } = await supabase
        .from('bookings')
        .select('customer_name, customer_email, customer_phone, user_id, booked_at, booking_details')
        .order('booked_at', { ascending: false });

      if (bookingsError) {
        console.error('[ManualSaleModal] Error loading bookings:', bookingsError);
      }

      if (bookingsData) {
        console.log('[ManualSaleModal] Bookings found:', bookingsData.length);
        bookingsData.forEach((booking: any) => {
          const details = booking.booking_details?.customer || {};
          const customerName = booking.customer_name || details.fullName || 'Cliente';
          const customerEmail = booking.customer_email || details.email || null;
          const customerPhone = booking.customer_phone || details.phone || null;
          const key = customerEmail || customerPhone || booking.user_id;

          if (key) {
            const existing = customerMap.get(key);
            if (existing) {
              if (!existing.phone && customerPhone) existing.phone = customerPhone;
              if (!existing.email && customerEmail) existing.email = customerEmail;
              if (existing.full_name === 'Cliente' && customerName) existing.full_name = customerName;
            } else {
              customerMap.set(key, {
                id: booking.user_id || key,
                full_name: customerName,
                email: customerEmail,
                phone: customerPhone
              });
            }
          }
        });
        console.log('[ManualSaleModal] Unique customers from bookings:', customerMap.size);
      }

      // Get customers from customers table
      const { data: customersData, error: customersError } = await supabase
        .from('customers')
        .select('*')
        .order('created_at', { ascending: false });

      if (!customersError && customersData) {
        console.log('[ManualSaleModal] Customers from customers table:', customersData.length);
        customersData.forEach((c: any) => {
          const key = c.email || c.phone || c.id;
          if (key && !customerMap.has(key)) {
            customerMap.set(key, {
              id: c.id,
              full_name: c.full_name || 'Cliente',
              email: c.email,
              phone: c.phone
            });
          }
        });
      }

      // Get customers from customers_extended table
      const { data: customersExtendedData, error: customersExtendedError } = await supabase
        .from('customers_extended')
        .select('*')
        .order('created_at', { ascending: false });

      if (customersExtendedError) {
        console.error('[ManualSaleModal] Error loading customers_extended:', customersExtendedError);
      }

      if (!customersExtendedError && customersExtendedData) {
        console.log('[ManualSaleModal] Extended customers found:', customersExtendedData.length);
        customersExtendedData.forEach((customer: any) => {
          const key = customer.email || customer.telefono || customer.id;

          let fullName = 'Cliente';
          if (customer.tipo_cliente === 'persona_fisica') {
            fullName = `${customer.nome || ''} ${customer.cognome || ''}`.trim();
          } else if (customer.tipo_cliente === 'azienda') {
            fullName = customer.ragione_sociale || customer.denominazione || 'Azienda';
          } else if (customer.tipo_cliente === 'pubblica_amministrazione') {
            fullName = customer.denominazione || customer.ente_ufficio || 'PA';
          }

          const extendedData: Customer = {
            id: customer.id,
            full_name: fullName,
            email: customer.email,
            phone: customer.telefono,
            tipo_cliente: customer.tipo_cliente,
            nome: customer.nome,
            cognome: customer.cognome,
            ragione_sociale: customer.ragione_sociale,
            denominazione: customer.denominazione,
            ente_ufficio: customer.ente_ufficio,
            telefono: customer.telefono
          };

          if (!customerMap.has(key)) {
            customerMap.set(key, extendedData);
          } else {
            const existing = customerMap.get(key)!;
            customerMap.set(key, {
              ...existing,
              ...extendedData
            });
          }
        });
      }

      const mergedCustomers = Array.from(customerMap.values());
      console.log('[ManualSaleModal] Total customers:', mergedCustomers.length);

      setCustomers(mergedCustomers);
      setFilteredCustomers(mergedCustomers);
    };
    loadCustomers();
  }, []);

  // Filter customers based on search - search by name, email, phone
  useEffect(() => {
    if (!searchTerm.trim()) {
      setFilteredCustomers(customers);
    } else {
      const search = searchTerm.toLowerCase();
      const filtered = customers.filter(c =>
        (c.full_name && c.full_name.toLowerCase().includes(search)) ||
        (c.email && c.email.toLowerCase().includes(search)) ||
        (c.phone && c.phone.toLowerCase().includes(search))
      );
      setFilteredCustomers(filtered);
    }
  }, [searchTerm, customers]);

  // Calculate discounted price based on quantity
  const calculateTotalPrice = (qty: number): number => {
    if (qty < 10) {
      return qty * 25;
    } else if (qty >= 10 && qty < 100) {
      return qty * 22;
    } else if (qty === 100) {
      return 1999;
    } else {
      return qty * 20;
    }
  };

  const totalPrice = calculateTotalPrice(tickets.length);
  const originalPrice = tickets.length * 25;
  const discount = originalPrice - totalPrice;

  const handleSelectCustomer = (customer: Customer) => {
    setEmail(customer.email || '');
    setPhone(customer.phone || '');
    setFullName(customer.full_name);
    setShowClientSelector(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Validate all required fields
    const missingFields: string[] = [];
    if (!email || email.trim() === '') missingFields.push('Email');
    if (!fullName || fullName.trim() === '') missingFields.push('Nome completo');
    if (!phone || phone.trim() === '') missingFields.push('Telefono');
    if (!paymentMethod) missingFields.push('Metodo di pagamento');

    if (missingFields.length > 0) {
      alert(`❌ DATI MANCANTI!\n\nPer completare la vendita del biglietto, devi inserire:\n\n${missingFields.map(f => `• ${f}`).join('\n')}\n\nCompila tutti i campi richiesti o seleziona un cliente esistente.`);
      return;
    }

    // All fields are valid, proceed with sale
    onConfirm(tickets, email, fullName, phone, paymentMethod);
  };

  return (
    <div className="fixed inset-0 bg-theme-bg-primary bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-[600px] max-h-[80vh] overflow-y-auto">
        <h3 className="text-xl font-bold mb-4">
          {isBulkSale
            ? `Vendita Multipla - ${tickets.length} Biglietti`
            : `Vendita Manuale - Biglietto #${String(tickets[0]).padStart(4, '0')}`
          }
        </h3>

        {isBulkSale && (
          <div className="mb-4 p-3 bg-gray-100 rounded">
            <p className="text-sm font-medium mb-2">Biglietti selezionati:</p>
            <div className="flex flex-wrap gap-2">
              {tickets.map(num => (
                <span key={num} className="px-2 py-1 bg-blue-600 text-theme-text-primary text-xs rounded">
                  #{String(num).padStart(4, '0')}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Step 1: Select Client */}
        {showClientSelector && (
          <div className="mb-4">
            <h4 className="text-lg font-semibold mb-3">Step 1: Seleziona Cliente</h4>

            <div className="mb-3">
              <input
                type="text"
                placeholder="Cerca per nome, email, azienda..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full border rounded px-3 py-2 mb-2"
              />

              <div className="border rounded max-h-60 overflow-y-auto">
                {customers.length === 0 ? (
                  <div className="p-4 text-center text-gray-500">
                    Caricamento clienti...
                  </div>
                ) : filteredCustomers.length === 0 ? (
                  <div className="p-4 text-center text-gray-500">
                    Nessun cliente trovato per "{searchTerm}"
                  </div>
                ) : (
                  filteredCustomers.map(customer => (
                    <div
                      key={customer.id}
                      onClick={() => handleSelectCustomer(customer)}
                      className="p-3 border-b hover:bg-blue-50 cursor-pointer transition-colors"
                    >
                      <div className="font-medium">{customer.full_name}</div>
                      {customer.email && (
                        <div className="text-sm text-gray-600">{customer.email}</div>
                      )}
                      {customer.phone && (
                        <div className="text-xs text-gray-500">{customer.phone}</div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 mt-4">
              <div className="flex-1 border-t border-gray-300"></div>
              <span className="text-sm text-gray-500">oppure</span>
              <div className="flex-1 border-t border-gray-300"></div>
            </div>

            <button
              type="button"
              onClick={() => {
                onOpenNewClientModal();
                onClose();
              }}
              className="w-full mt-4 px-4 py-3 bg-green-600 text-theme-text-primary rounded-full hover:bg-green-700 font-semibold"
            >
              + Crea Nuovo Cliente
            </button>

            <button
              type="button"
              onClick={onClose}
              className="w-full mt-2 px-4 py-2 bg-gray-300 rounded-full hover:bg-gray-400"
            >
              Annulla
            </button>
          </div>
        )}

        {/* Step 2: Select Payment Method */}
        {!showClientSelector && (
          <div>
            <h4 className="text-lg font-semibold mb-3">Step 2: Metodo di Pagamento</h4>

            <div className="mb-4 p-4 bg-gray-50 rounded border">
              <div className="text-sm text-gray-600 mb-1">Cliente selezionato:</div>
              <div className="font-medium">{fullName}</div>
              <div className="text-sm text-gray-600">{email}</div>
              <div className="text-sm text-gray-600">{phone}</div>
              <button
                type="button"
                onClick={() => setShowClientSelector(true)}
                className="text-xs text-blue-600 hover:text-blue-800 underline mt-2"
              >
                Cambia cliente
              </button>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Metodo di Pagamento</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="w-full border rounded px-3 py-2"
                required
              >
                <option value="Contanti">Contanti</option>
                <option value="Carta">Carta</option>
                <option value="Bonifico">Bonifico</option>
                <option value="Paypal">Paypal</option>
              </select>
            </div>

            {discount > 0 && (
              <div className="mb-4 p-3 bg-yellow-50 border border-yellow-300 rounded">
                <p className="text-sm font-semibold text-yellow-800 mb-1">Sconto applicato!</p>
                <p className="text-xs text-yellow-700">
                  Prezzo originale: €{originalPrice.toFixed(2)}
                </p>
                <p className="text-xs text-yellow-700">
                  Sconto: -€{discount.toFixed(2)}
                </p>
                <p className="text-sm font-bold text-yellow-900 mt-1">
                  Totale: €{totalPrice.toFixed(2)}
                </p>
              </div>
            )}
            {discount === 0 && (
              <div className="mb-4 p-3 bg-gray-100 rounded">
                <p className="text-sm font-bold text-gray-900">
                  Totale: €{totalPrice.toFixed(2)}
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-gray-300 rounded-full hover:bg-gray-400"
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                className="px-4 py-2 bg-blue-600 text-theme-text-primary rounded-full hover:bg-blue-700 font-semibold"
              >
                Conferma Vendita
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const LotteriaBoard: React.FC = () => {
  const { canViewFinancials } = useAdminRole();
  const [soldTickets, setSoldTickets] = useState<Map<number, Ticket>>(new Map());
  const [loading, setLoading] = useState(true);
  const [hoveredTicket, setHoveredTicket] = useState<number | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<number | null>(null);
  const [selectedTickets, setSelectedTickets] = useState<number[]>([]);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [searchEmail, setSearchEmail] = useState('');
  const [sendingEmails, setSendingEmails] = useState(false);
  const [searchResults, setSearchResults] = useState<Ticket[]>([]);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [hideFinancials, setHideFinancials] = useState(false);
  const [showNewClientModal, setShowNewClientModal] = useState(false);
  const [pendingTicketNumbers, setPendingTicketNumbers] = useState<number[] | null>(null);
  const [isBulkSale, setIsBulkSale] = useState(false);
  const [prefillData, setPrefillData] = useState<{ email: string; fullName: string; phone: string } | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [pendingClientData, setPendingClientData] = useState<{ email: string; fullName: string; phone: string } | null>(null);
  const isCreatingClient = useRef(false);
  const [showTicketDetailsModal, setShowTicketDetailsModal] = useState(false);
  const [selectedTicketForDetails, setSelectedTicketForDetails] = useState<Ticket | null>(null);

  // Email template editor states
  const [showEmailEditorModal, setShowEmailEditorModal] = useState(false);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailTextContent, setEmailTextContent] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);
  const [availableClients, setAvailableClients] = useState<Array<{ email: string; full_name: string }>>([]);
  const [loadingClients, setLoadingClients] = useState(false);
  const [clientSearchFilter, setClientSearchFilter] = useState('');

  const fetchSoldTickets = async () => {
    try {
      setLoading(true);

      // Step 1: Fetch all tickets
      const { data: ticketsData, error: ticketsError } = await supabase
        .from('commercial_operation_tickets')
        .select('*')
        .order('ticket_number', { ascending: true });

      if (ticketsError) {
        console.error('Error fetching tickets:', ticketsError);
        throw ticketsError;
      }

      // Step 2: Get unique emails from tickets
      const uniqueEmails = [...new Set(ticketsData?.map(t => t.email).filter(Boolean) || [])];

      // Step 3: Fetch customer data for these emails from customers_extended
      const { data: customersExtended } = await supabase
        .from('customers_extended')
        .select('*')
        .in('email', uniqueEmails);

      // Step 4: Also try old customers table as fallback
      const { data: customersOld } = await supabase
        .from('customers')
        .select('*')
        .in('email', uniqueEmails);

      // Step 5: Create email -> customer data map (prefer customers_extended)
      const customerMap = new Map();

      // First add old customers data
      customersOld?.forEach(customer => {
        if (customer.email) {
          customerMap.set(customer.email, {
            tipo_cliente: 'persona_fisica',
            nome: customer.full_name?.split(' ')[0] || '',
            cognome: customer.full_name?.split(' ').slice(1).join(' ') || '',
            telefono: customer.phone,
            email: customer.email
          });
        }
      });

      // Then override with customers_extended (more complete data)
      customersExtended?.forEach(customer => {
        if (customer.email) {
          customerMap.set(customer.email, customer);
        }
      });

      // Step 6: Merge ticket data with customer data
      const ticketMap = new Map<number, Ticket>();
      ticketsData?.forEach((ticket) => {
        const customerData = customerMap.get(ticket.email);
        ticketMap.set(ticket.ticket_number, {
          ...ticket,
          customer_data: customerData || null
        });
      });

      setSoldTickets(ticketMap);
    } catch (error) {
      console.error('Error fetching tickets:', error);
      alert('Errore nel caricamento dei biglietti. Controlla i permessi del database.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSoldTickets();
  }, []);

  // Calculate discounted price based on quantity
  const calculateTotalPrice = (qty: number): number => {
    if (qty < 10) {
      return qty * 25;
    } else if (qty >= 10 && qty < 100) {
      return qty * 22;
    } else if (qty === 100) {
      return 1999;
    } else {
      return qty * 20;
    }
  };

  const handleBulkManualSale = async (ticketNumbers: number[], email: string, fullName: string, phone: string, paymentMethod: string = 'Contanti') => {
    try {
      setGeneratingPdf(true);
      let successCount = 0;
      let failedTickets: number[] = [];

      // Calculate total discounted price for all tickets
      const totalPrice = calculateTotalPrice(ticketNumbers.length);
      const pricePerTicket = Math.round((totalPrice / ticketNumbers.length) * 100); // in cents

      for (const ticketNumber of ticketNumbers) {
        try {
          // Check ticket is still available
          const { data: existingTicket } = await supabase
            .from('commercial_operation_tickets')
            .select('ticket_number')
            .eq('ticket_number', ticketNumber)
            .single();

          if (existingTicket) {
            failedTickets.push(ticketNumber);
            continue;
          }

          const uuid = generateTicketUuid(ticketNumber);

          const ticketData: any = {
            uuid: uuid,
            ticket_number: ticketNumber,
            email,
            full_name: fullName,
            customer_phone: phone,
            payment_intent_id: `manual_bulk_${paymentMethod}_${Date.now()}_${ticketNumber}`,
            amount_paid: pricePerTicket, // Discounted price per ticket
            currency: 'eur',
            purchase_date: new Date().toISOString(),
            quantity: 1
          };

          // Try with payment_method first
          let insertResult = await supabase
            .from('commercial_operation_tickets')
            .insert([{ ...ticketData, payment_method: paymentMethod }]);

          // If payment_method column doesn't exist, try without it
          if (insertResult.error && insertResult.error.code === '42703') {
            insertResult = await supabase
              .from('commercial_operation_tickets')
              .insert([ticketData]);
          }

          const { error } = insertResult;

          if (error) {
            console.error(`[Lottery] Bulk sale - ticket ${ticketNumber} error:`, error);
            if (error.code === '23505') {
              failedTickets.push(ticketNumber);
            } else {
              throw error;
            }
          } else {
            successCount++;

            // Generate and send PDF for this ticket
            try {
              // Fetch full customer data from database
              const { data: customerData } = await supabase
                .from('customers_extended')
                .select('*')
                .eq('email', email)
                .single();

              await fetch('/.netlify/functions/send-manual-ticket-pdf', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  ticketNumber,
                  email,
                  fullName,
                  phone,
                  customerData: customerData || {} // Include all customer fields
                })
              });
            } catch (pdfError) {
              console.error(`Error sending PDF for ticket ${ticketNumber}:`, pdfError);
            }
          }
        } catch (error) {
          console.error(`Error processing ticket ${ticketNumber}:`, error);
          failedTickets.push(ticketNumber);
        }
      }

      setGeneratingPdf(false);

      // Send WhatsApp notification for successfully sold tickets
      let whatsappResult: { success: boolean; error?: string } = { success: true };
      if (successCount > 0) {
        const soldTicketNumbers = ticketNumbers.filter(n => !failedTickets.includes(n));
        whatsappResult = await sendWhatsAppNotification(soldTicketNumbers, fullName, email, phone);
        if (!whatsappResult.success) {
          console.warn('[WhatsApp] Failed to send notification:', whatsappResult.error);
        }
      }

      // Build alert message
      let message = '';
      if (successCount > 0 && failedTickets.length === 0) {
        message = `${successCount} biglietti venduti con successo!\n\nPDF inviati a: ${email}`;
      } else if (successCount > 0 && failedTickets.length > 0) {
        message = `${successCount} biglietti venduti.\n\n${failedTickets.length} biglietti già venduti:\n${failedTickets.map(n => '#' + String(n).padStart(4, '0')).join(', ')}`;
      } else {
        message = `Nessun biglietto venduto. Tutti i biglietti selezionati sono già stati venduti.`;
      }

      // Add WhatsApp warning if failed
      if (successCount > 0 && !whatsappResult.success) {
        message += `\n\nATTENZIONE: Notifica WhatsApp NON inviata!\nMotivo: ${whatsappResult.error}`;
      }

      alert(message);

      await fetchSoldTickets();
      setSelectedTicket(null);
      setSelectedTickets([]);
      setMultiSelectMode(false);
    } catch (error: any) {
      setGeneratingPdf(false);
      console.error('Error in bulk sale:', error);
      alert(`Errore: ${error.message || 'Errore durante la vendita multipla.'}`);
      await fetchSoldTickets();
    }
  };

  const handleManualSale = async (ticketNumber: number, email: string, fullName: string, phone: string, paymentMethod: string = 'Contanti') => {
    try {
      console.log('[handleManualSale] ========== STARTING SALE ==========');
      console.log('[handleManualSale] Ticket:', ticketNumber);
      console.log('[handleManualSale] Email:', email);
      console.log('[handleManualSale] Name:', fullName);
      console.log('[handleManualSale] Phone:', phone);
      console.log('[handleManualSale] Payment:', paymentMethod);

      // Double-check ticket is still available before attempted sale
      console.log('[handleManualSale] Checking if ticket is already sold...');
      const { data: existingTicket } = await supabase
        .from('commercial_operation_tickets')
        .select('ticket_number')
        .eq('ticket_number', ticketNumber)
        .single();

      if (existingTicket) {
        console.log('[handleManualSale] Ticket already sold, aborting');
        alert(`Biglietto #${String(ticketNumber).padStart(4, '0')} è già stato venduto!`);
        await fetchSoldTickets(); // Refresh to show current state
        setSelectedTicket(null);
        return;
      }

      console.log('[handleManualSale] Ticket is available, proceeding with sale');

      const uuid = generateTicketUuid(ticketNumber);

      const ticketData: any = {
        uuid: uuid,
        ticket_number: ticketNumber,
        email,
        full_name: fullName,
        customer_phone: phone,
        payment_intent_id: `manual_${paymentMethod}_${Date.now()}`,
        amount_paid: 2500, // 25€ for single ticket
        currency: 'eur',
        purchase_date: new Date().toISOString(),
        quantity: 1
      };

      console.log('[handleManualSale] Attempting to insert ticket with data:', ticketData);

      // Try with payment_method first
      console.log('[handleManualSale] Inserting into database with payment_method...');
      let insertResult = await supabase
        .from('commercial_operation_tickets')
        .insert([{ ...ticketData, payment_method: paymentMethod }]);

      console.log('[handleManualSale] Insert result:', insertResult);

      // If payment_method column doesn't exist, try without it
      if (insertResult.error && insertResult.error.code === '42703') {
        console.warn('[handleManualSale] payment_method column not found, retrying without it');
        insertResult = await supabase
          .from('commercial_operation_tickets')
          .insert([ticketData]);
        console.log('[handleManualSale] Retry insert result:', insertResult);
      }

      const { error } = insertResult;

      if (error) {
        console.error('[handleManualSale] Database insert error:', error);
        // Check if it's a duplicate key error (ticket was just sold)
        if (error.code === '23505') {
          alert(`Biglietto #${String(ticketNumber).padStart(4, '0')} è appena stato venduto da qualcun altro!`);
          await fetchSoldTickets(); // Refresh to show current state
          setSelectedTicket(null);
          return; // Stop execution here
        } else {
          // Show detailed error to user
          alert(`Errore nel salvare il biglietto: ${error.message}\n\nCodice: ${error.code}\n\nDettagli: ${JSON.stringify(error.details || {})}`);
          throw error;
        }
      } else {
        // Successfully inserted ticket, now generate and send PDF
        console.log(`[Lottery] Ticket ${ticketNumber} inserted, generating PDF...`);
        setGeneratingPdf(true);

        // Send WhatsApp notification to admin
        const whatsappResult = await sendWhatsAppNotification([ticketNumber], fullName, email, phone);
        if (!whatsappResult.success) {
          console.warn('[WhatsApp] Failed to send notification:', whatsappResult.error);
        }

        try {
          console.log('[Lottery] Fetching full customer data from database...');
          // Fetch full customer data from database
          const { data: customerData } = await supabase
            .from('customers_extended')
            .select('*')
            .eq('email', email)
            .single();

          console.log('[Lottery] Customer data fetched:', customerData);

          console.log('[Lottery] Calling PDF generation function...');
          const pdfResponse = await fetch('https://dr7empire.com/.netlify/functions/send-manual-ticket-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ticketNumber,
              email,
              fullName,
              phone,
              customerData: customerData || {} // Include all customer fields
            })
          });

          console.log('[Lottery] PDF function response status:', pdfResponse.status);
          const pdfResult = await pdfResponse.json();
          console.log('[Lottery] PDF function result:', pdfResult);

          setGeneratingPdf(false);

          // Build success message with WhatsApp warning if needed
          let message = `Biglietto #${String(ticketNumber).padStart(4, '0')} venduto!\n\n`;

          if (pdfResult.success) {
            message += `PDF inviato con successo a:\n${email}`;
          } else {
            message += `PDF non inviato automaticamente.\nMotivo: ${pdfResult.error}\n\nEmail: ${email}`;
          }

          if (!whatsappResult.success) {
            message += `\n\nATTENZIONE: Notifica WhatsApp NON inviata!\nMotivo: ${whatsappResult.error}`;
          }

          alert(message);
        } catch (pdfError: any) {
          setGeneratingPdf(false);
          console.error('Error sending PDF:', pdfError);

          let message = `Biglietto #${String(ticketNumber).padStart(4, '0')} salvato nel sistema.\n\nATTENZIONE: Errore nell'invio del PDF.\nErrore: ${pdfError.message || 'Network error'}\n\nEmail: ${email}`;

          if (!whatsappResult.success) {
            message += `\n\nNotifica WhatsApp NON inviata!\nMotivo: ${whatsappResult.error}`;
          }

          alert(message);
        }
      }

      // Always refresh the board after attempt
      await fetchSoldTickets();
      setSelectedTicket(null);
    } catch (error: any) {
      console.error('Error saving manual sale:', error);
      alert(`Errore: ${error.message || 'Errore durante il salvataggio.'}`);
      await fetchSoldTickets(); // Refresh to show current state
      setSelectedTicket(null);
    }
  };

  const handleTicketClick = (ticketNumber: number) => {
    console.log('[TicketClick] Clicked ticket:', ticketNumber);

    if (soldTickets.has(ticketNumber)) {
      console.log('[TicketClick] Ticket already sold, showing details modal');
      // Show ticket details modal
      const ticket = soldTickets.get(ticketNumber);
      if (ticket) {
        setSelectedTicketForDetails(ticket);
        setShowTicketDetailsModal(true);
      }
      return;
    }

    if (multiSelectMode) {
      console.log('[TicketClick] Multi-select mode');
      // Toggle selection in multi-select mode
      setSelectedTickets(prev => {
        if (prev.includes(ticketNumber)) {
          return prev.filter(num => num !== ticketNumber);
        } else {
          return [...prev, ticketNumber];
        }
      });
    } else {
      // Single ticket sale - Open ManualSaleModal directly
      console.log('[TicketClick] Opening ManualSaleModal for ticket:', ticketNumber);
      setSelectedTicket(ticketNumber);
    }
  };

  const handleSearchTickets = async () => {
    if (!searchEmail.trim()) {
      alert('Inserisci un email o nome del cliente');
      return;
    }

    try {
      const searchTerm = searchEmail.trim().toLowerCase();

      // Search by email OR name
      const { data, error } = await supabase
        .from('commercial_operation_tickets')
        .select('*')
        .or(`email.ilike.%${searchTerm}%,full_name.ilike.%${searchTerm}%`)
        .order('ticket_number', { ascending: true });

      if (error) throw error;

      if (!data || data.length === 0) {
        alert(`Nessun biglietto trovato per: ${searchEmail}`);
        return;
      }

      setSearchResults(data);
      setShowSearchModal(true);
    } catch (error: any) {
      console.error('Error searching tickets:', error);
      alert(`Errore nella ricerca: ${error.message}`);
    }
  };

  const handleCancelTicket = async (ticketNumber: number, email: string, fullName: string) => {
    if (!confirm(`Sei sicuro di voler cancellare il biglietto #${String(ticketNumber).padStart(4, '0')} di ${fullName}?`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('commercial_operation_tickets')
        .delete()
        .eq('ticket_number', ticketNumber)
        .eq('email', email);

      if (error) throw error;

      alert(`Biglietto #${String(ticketNumber).padStart(4, '0')} cancellato con successo!`);

      // Refresh tickets
      await fetchSoldTickets();

      // Close ticket details modal if open
      setShowTicketDetailsModal(false);
      setSelectedTicketForDetails(null);

      // Refresh search results if search modal is open
      if (showSearchModal && searchResults.length > 0) {
        // Re-run the search to get updated results
        const searchTerm = searchEmail.trim().toLowerCase();
        const { data } = await supabase
          .from('commercial_operation_tickets')
          .select('*')
          .or(`email.ilike.%${searchTerm}%,full_name.ilike.%${searchTerm}%`)
          .order('ticket_number', { ascending: true });

        if (data && data.length > 0) {
          setSearchResults(data);
        } else {
          // No more tickets for this customer, close search modal
          setShowSearchModal(false);
          setSearchResults([]);
          setSearchEmail('');
        }
      }
    } catch (error: any) {
      console.error('Error canceling ticket:', error);
      alert(`Errore nella cancellazione: ${error.message}`);
    }
  };

  const handleLoadAvailableClients = async () => {
    setLoadingClients(true);
    try {
      const { data, error } = await supabase
        .from('commercial_operation_tickets')
        .select('email, full_name')
        .order('full_name');

      if (error) throw error;

      // Filter out null/empty emails and get unique clients by email
      const validData = (data || []).filter(c => c.email && c.email.trim() !== '');
      const uniqueClients = Array.from(
        new Map(validData.map(c => [c.email.toLowerCase(), c])).values()
      );

      setAvailableClients(uniqueClients);
    } catch (error: any) {
      console.error('[LotteriaBoard] Error loading clients:', error);
      alert(`Errore nel caricamento dei clienti: ${error.message}`);
    } finally {
      setLoadingClients(false);
    }
  };

  const handleSendEmailsFromModal = async () => {
    // Validate fields
    if (!emailSubject.trim() || !emailTextContent.trim()) {
      alert('Per favore compila sia l\'oggetto che il contenuto dell\'email prima di inviarla.');
      return;
    }

    // Determine recipients
    const sendToAll = selectedRecipients.length === 0;
    const recipientCount = sendToAll ? availableClients.length : selectedRecipients.length;

    // Confirm send
    const confirmMessage = sendToAll
      ? `Sei sicuro di voler inviare l'email a TUTTI i ${recipientCount} clienti che hanno comprato biglietti?\n\nQuesta azione invierà un'email personalizzata a tutti gli acquirenti.`
      : `Sei sicuro di voler inviare l'email a ${recipientCount} cliente${recipientCount > 1 ? 'i' : ''} selezionat${recipientCount > 1 ? 'i' : 'o'}?\n\nQuesta azione invierà un'email ai clienti selezionati.`;

    if (!confirm(confirmMessage)) {
      return;
    }

    setSendingEmails(true);
    try {
      // First, auto-save the template
      console.log('[LotteriaBoard] Auto-saving template before sending...');

      // Auto-generate HTML from text content
      const textLines = emailTextContent.split('\n');
      const htmlParagraphs = textLines.map(line => {
        if (line.trim() === '') {
          return '<br>';
        }
        return `<p>${line}</p>`;
      }).join('\n            ');

      const autoGeneratedHtml = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #FFD700 0%, #FFA500 100%); color: #000; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
        p { margin: 10px 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1 style="margin: 0;">DR7 EMPIRE LOTTERIA</h1>
        </div>
        <div class="content">
            ${htmlParagraphs}
        </div>
        <div class="footer">
            <p>DR7 Empire - Luxury Car Rental & Services</p>
        </div>
    </div>
</body>
</html>`;

      await fetch('/.netlify/functions/save-lottery-email-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateName: `Email Lotteria - ${new Date().toLocaleDateString('it-IT')}`,
          subject: emailSubject,
          htmlContent: autoGeneratedHtml,
          textContent: emailTextContent
        })
      });

      // Then send emails
      console.log('[LotteriaBoard] Sending emails...');

      const requestBody: any = {};
      if (!sendToAll) {
        requestBody.recipientEmails = selectedRecipients;
      }

      const response = await fetch('/.netlify/functions/send-lottery-postponement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      const result = await response.json();

      if (response.ok && result.success) {
        alert(`✅ Email inviate con successo!\n\nInviate: ${result.sent}\nFallite: ${result.failed}\nTotale clienti: ${result.total}`);
        setShowEmailEditorModal(false);
        setSelectedRecipients([]); // Reset selection
      } else {
        throw new Error(result.error || 'Errore sconosciuto');
      }
    } catch (error: any) {
      console.error('[LotteriaBoard] Error sending emails:', error);
      alert(`❌ Errore nell\'invio delle email:\n${error.message}`);
    } finally {
      setSendingEmails(false);
    }
  };

  const handleLoadEmailTemplate = async () => {
    setLoadingTemplate(true);
    try {
      const response = await fetch('/.netlify/functions/get-lottery-email-template');
      const result = await response.json();

      if (response.ok && result.success && result.template) {
        setEmailSubject(result.template.subject);
        setEmailTextContent(result.template.text_content);
      } else {
        // Load default template
        setEmailSubject('Importante: Comunicazione Lotteria DR7 Empire');
        setEmailTextContent('Gentile Cliente,\n\nInserisci qui il contenuto della tua email...\n\nCordiali saluti,\nIl Team DR7 Empire');
      }
    } catch (error: any) {
      console.error('[LotteriaBoard] Error loading template:', error);
      alert(`Errore nel caricamento del template: ${error.message}`);
    } finally {
      setLoadingTemplate(false);
    }
  };

  const handleSaveEmailTemplate = async () => {
    if (!emailSubject.trim() || !emailTextContent.trim()) {
      alert('Tutti i campi sono obbligatori: Oggetto e Contenuto Email');
      return;
    }

    setSavingTemplate(true);
    try {
      // Auto-generate HTML from text content
      const textLines = emailTextContent.split('\n');
      const htmlParagraphs = textLines.map(line => {
        if (line.trim() === '') {
          return '<br>';
        }
        return `<p>${line}</p>`;
      }).join('\n            ');

      const autoGeneratedHtml = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #FFD700 0%, #FFA500 100%); color: #000; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
        p { margin: 10px 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1 style="margin: 0;">DR7 EMPIRE LOTTERIA</h1>
        </div>
        <div class="content">
            ${htmlParagraphs}
        </div>
        <div class="footer">
            <p>DR7 Empire - Luxury Car Rental & Services</p>
        </div>
    </div>
</body>
</html>`;

      const response = await fetch('/.netlify/functions/save-lottery-email-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateName: `Email Lotteria - ${new Date().toLocaleDateString('it-IT')}`,
          subject: emailSubject,
          htmlContent: autoGeneratedHtml,
          textContent: emailTextContent
        })
      });

      const result = await response.json();

      if (response.ok && result.success) {
        alert('✅ Template salvato con successo!\n\nQuesto template verrà utilizzato per le prossime email inviate ai clienti.');
        setShowEmailEditorModal(false);
      } else {
        throw new Error(result.error || 'Errore sconosciuto');
      }
    } catch (error: any) {
      console.error('[LotteriaBoard] Error saving template:', error);
      alert(`❌ Errore nel salvataggio del template:\n${error.message}`);
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleOpenEmailEditor = async () => {
    setShowEmailEditorModal(true);
    setSelectedRecipients([]); // Reset selection when opening
    setClientSearchFilter(''); // Reset search filter
    await Promise.all([
      handleLoadEmailTemplate(),
      handleLoadAvailableClients()
    ]);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-xl">Caricamento...</div>
      </div>
    );
  }

  const totalTickets = 2000;
  const soldCount = soldTickets.size;
  const availableCount = totalTickets - soldCount;

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-4 text-theme-text-primary">Tabellone LOTTERIA</h2>

        {/* Search Bar */}
        <div className="mb-6 bg-theme-bg-tertiary border border-theme-border rounded-full p-4">
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium text-theme-text-secondary mb-2">
                🔍 Cerca Cliente per Email o Nome
              </label>
              <input
                type="text"
                placeholder="Inserisci email o nome del cliente..."
                value={searchEmail}
                onChange={(e) => setSearchEmail(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearchTickets()}
                className="w-full px-4 py-2 bg-gray-700 border border-theme-border-light rounded-full text-theme-text-primary placeholder-gray-400 focus:outline-none focus:border-dr7-gold transition-colors"
              />
            </div>
            <button
              onClick={handleSearchTickets}
              className="px-6 py-2 bg-dr7-gold hover:bg-yellow-500 text-black font-semibold rounded-full transition-colors whitespace-nowrap"
            >
              🔍 Cerca Biglietti
            </button>
          </div>
          <p className="text-xs text-theme-text-muted mt-2">
            Cerca un cliente per vedere tutti i suoi biglietti e numeri associati
          </p>
        </div>

        {canViewFinancials && !hideFinancials && (
          <div className="grid gap-4 mb-4 grid-cols-4">
            <div className="bg-blue-50 p-4 rounded-full">
              <div className="text-sm text-gray-600">Totale Biglietti</div>
              <div className="text-2xl font-bold">{totalTickets}</div>
            </div>
            <div className="bg-red-50 p-4 rounded-full">
              <div className="text-sm text-gray-600">Venduti</div>
              <div className="text-2xl font-bold text-red-600">{soldCount}</div>
            </div>
            <div className="bg-green-50 p-4 rounded-full">
              <div className="text-sm text-gray-600">Disponibili</div>
              <div className="text-2xl font-bold text-green-600">{availableCount}</div>
            </div>
            <div className="bg-yellow-50 p-4 rounded-full">
              <div className="text-sm text-gray-600">Fatturato Totale</div>
              <div className="text-2xl font-bold text-yellow-600">
                €{((soldCount * 2500) / 100).toFixed(2)}
              </div>
            </div>
          </div>
        )}
        <div className="flex gap-4 items-center flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-green-500 rounded"></div>
            <span className="text-sm text-theme-text-primary font-medium">Disponibile</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-red-500 rounded"></div>
            <span className="text-sm text-theme-text-primary font-medium">Venduto</span>
          </div>
          {multiSelectMode && (
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-blue-600 rounded"></div>
              <span className="text-sm text-theme-text-primary font-medium">Selezionato</span>
            </div>
          )}
          <div className="flex items-center gap-2 ml-auto">
            {canViewFinancials && (
              <button
                onClick={() => setHideFinancials(!hideFinancials)}
                className={`px-4 py-2 rounded-full font-semibold transition-colors ${hideFinancials
                  ? 'bg-green-600 text-theme-text-primary hover:bg-green-700'
                  : 'bg-yellow-600 text-black hover:bg-yellow-700'
                  }`}
              >
                {hideFinancials ? 'MOSTRA' : 'NASCONDI'}
              </button>
            )}
            <button
              onClick={() => {
                setMultiSelectMode(!multiSelectMode)
                setSelectedTickets([])
              }}
              className={`px-4 py-2 rounded-full font-semibold transition-colors ${multiSelectMode
                ? 'bg-orange-600 text-theme-text-primary hover:bg-orange-700'
                : 'bg-gray-700 text-theme-text-primary hover:bg-gray-600'
                }`}
            >
              {multiSelectMode ? '✓ Selezione Multipla ON' : 'Selezione Multipla'}
            </button>
            {multiSelectMode && selectedTickets.length > 0 && (
              <>
                <button
                  onClick={() => setSelectedTickets([])}
                  className="px-4 py-2 bg-gray-600 text-theme-text-primary rounded-full hover:bg-theme-bg-hover"
                >
                  Pulisci ({selectedTickets.length})
                </button>
                <button
                  onClick={() => {
                    setSelectedTicket(-1); // -1 indicates bulk sale mode
                  }}
                  className="px-4 py-2 bg-green-600 text-theme-text-primary rounded-full hover:bg-green-700 font-semibold"
                >
                  Vendi {selectedTickets.length} Biglietti
                </button>
              </>
            )}
            <button
              onClick={fetchSoldTickets}
              className="px-4 py-2 bg-blue-600 text-theme-text-primary rounded-full hover:bg-blue-700"
            >
              Aggiorna
            </button>
            <button
              onClick={handleOpenEmailEditor}
              disabled={sendingEmails}
              className="px-4 py-2 bg-yellow-600 text-black rounded-full hover:bg-yellow-700 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sendingEmails ? 'Invio in corso...' : 'Manda Email'}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-10 sm:grid-cols-15 md:grid-cols-20 lg:grid-cols-25 xl:grid-cols-25 gap-1 relative" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(45px, 1fr))' }}>
        {Array.from({ length: totalTickets }, (_, i) => i + 1).map((ticketNumber) => {
          const isSold = soldTickets.has(ticketNumber);
          const ticket = soldTickets.get(ticketNumber);
          const isHovered = hoveredTicket === ticketNumber;
          const isSelected = selectedTickets.includes(ticketNumber);

          return (
            <div key={ticketNumber} className="relative">
              <div
                className={`
                  aspect-square flex items-center justify-center text-xs font-semibold rounded cursor-pointer
                  transition-all duration-200 border-2
                  ${isSold
                    ? 'bg-red-500 text-theme-text-primary border-red-700 hover:bg-red-600'
                    : isSelected
                      ? 'bg-blue-600 text-theme-text-primary border-blue-800 scale-105'
                      : 'bg-green-500 text-theme-text-primary border-green-700 hover:bg-green-600 hover:scale-110'
                  }
                `}
                onMouseEnter={() => setHoveredTicket(ticketNumber)}
                onMouseLeave={() => setHoveredTicket(null)}
                onClick={() => handleTicketClick(ticketNumber)}
              >
                {String(ticketNumber).padStart(4, '0')}
              </div>

              {isHovered && ticket && (
                <div className="absolute z-10 bottom-full left-1/2 transform -translate-x-1/2 mb-2 w-64 bg-theme-bg-primary text-theme-text-primary p-3 rounded-lg shadow-lg text-xs border border-theme-border">
                  <div className="font-bold mb-1">Biglietto #{String(ticketNumber).padStart(4, '0')}</div>
                  <div><strong>Cliente:</strong> {ticket.full_name}</div>
                  <div><strong>Email:</strong> {ticket.email}</div>
                  {ticket.customer_phone && <div><strong>Telefono:</strong> {ticket.customer_phone}</div>}
                  <div><strong>Data:</strong> {new Date(ticket.purchase_date).toLocaleDateString('it-IT')}</div>
                  {(ticket as any).payment_method && (
                    <div><strong>Pagamento:</strong> {(ticket as any).payment_method}</div>
                  )}
                  <div className="absolute top-full left-1/2 transform -translate-x-1/2 -mt-1">
                    <div className="border-8 border-transparent border-t-theme-bg-primary"></div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {selectedTicket && selectedTicket !== -1 && (
        <ManualSaleModal
          ticketNumber={selectedTicket}
          onClose={() => {
            setSelectedTicket(null);
            setPrefillData(null);
          }}
          onConfirm={(tickets, email, fullName, phone, paymentMethod) => {
            handleManualSale(tickets[0], email, fullName, phone, paymentMethod);
            setPrefillData(null);
          }}
          onOpenNewClientModal={() => {
            // Store current ticket number before opening NewClientModal
            console.log('[ManualSaleModal] Opening NewClientModal for single ticket:', selectedTicket);
            setPendingTicketNumbers([selectedTicket]);
            setIsBulkSale(false);
            setShowNewClientModal(true);
          }}
          prefillData={prefillData}
        />
      )}

      {selectedTicket === -1 && selectedTickets.length > 0 && (
        <ManualSaleModal
          ticketNumbers={selectedTickets}
          onClose={() => {
            setSelectedTicket(null);
            setSelectedTickets([]);
            setPrefillData(null);
          }}
          onConfirm={(tickets, email, fullName, phone, paymentMethod) => {
            handleBulkManualSale(tickets, email, fullName, phone, paymentMethod);
            setPrefillData(null);
          }}
          onOpenNewClientModal={() => {
            setShowNewClientModal(true);
          }}
          prefillData={prefillData}
        />
      )}

      <PaymentMethodModal
        isOpen={showPaymentModal}
        onClose={() => {
          setShowPaymentModal(false);
          setPendingTicketNumbers(null);
          setPendingClientData(null);
        }}
        onConfirm={async (paymentMethod) => {
          console.log('[PaymentModal] ========== CONFIRM BUTTON CLICKED ==========');
          console.log('[PaymentModal] Payment method:', paymentMethod);
          console.log('[PaymentModal] Pending tickets:', pendingTicketNumbers);
          console.log('[PaymentModal] Client data:', pendingClientData);
          console.log('[PaymentModal] Is bulk sale:', isBulkSale);

          setShowPaymentModal(false);

          // Complete the sale with the selected payment method
          if (pendingTicketNumbers && pendingTicketNumbers.length > 0 && pendingClientData) {
            try {
              if (isBulkSale && pendingTicketNumbers.length > 1) {
                console.log('[PaymentModal] Starting BULK sale for', pendingTicketNumbers.length, 'tickets...');
                await handleBulkManualSale(
                  pendingTicketNumbers,
                  pendingClientData.email,
                  pendingClientData.fullName,
                  pendingClientData.phone,
                  paymentMethod
                );
                console.log('[PaymentModal] Bulk sale completed');
              } else {
                console.log('[PaymentModal] Starting SINGLE sale for ticket', pendingTicketNumbers[0], '...');
                await handleManualSale(
                  pendingTicketNumbers[0],
                  pendingClientData.email,
                  pendingClientData.fullName,
                  pendingClientData.phone,
                  paymentMethod
                );
                console.log('[PaymentModal] Single sale completed');
              }
              console.log('[PaymentModal] Sale process finished successfully');
            } catch (error) {
              console.error('[PaymentModal] Error during sale:', error);
              alert(`Errore durante la vendita: ${error}`);
            }
          } else {
            console.error('[PaymentModal] VALIDATION FAILED - Missing data:');
            console.error('  - Tickets:', pendingTicketNumbers);
            console.error('  - Client:', pendingClientData);
            alert('Errore: dati mancanti per completare la vendita');
          }

          // Reset state
          console.log('[PaymentModal] Resetting state...');
          setPendingTicketNumbers(null);
          setPendingClientData(null);
        }}
        ticketCount={pendingTicketNumbers?.length || 1}
      />

      <NewClientModal
        isOpen={showNewClientModal}
        onClose={() => {
          console.log('[NewClientModal] onClose called');
          console.log('[NewClientModal] isCreatingClient.current:', isCreatingClient.current);
          setShowNewClientModal(false);
          // Only reset state if user cancelled (not in the middle of creating a client)
          if (!isCreatingClient.current) {
            console.log('[NewClientModal] User cancelled, resetting state');
            setPendingTicketNumbers(null);
            setPendingClientData(null);
          } else {
            console.log('[NewClientModal] Client creation in progress, keeping state');
          }
        }}
        onClientCreated={async (clientId) => {
          console.log('[NewClientModal] ===== CLIENT CREATED =====');
          console.log('[NewClientModal] Client ID:', clientId);
          console.log('[NewClientModal] pendingTicketNumbers:', pendingTicketNumbers);
          console.log('[NewClientModal] isBulkSale:', isBulkSale);

          // Set flag to prevent onClose from resetting state
          isCreatingClient.current = true;

          try {
            // Fetch the client data
            const { data, error } = await supabase
              .from('customers_extended')
              .select('*')
              .eq('id', clientId)
              .single();

            if (error) {
              console.error('[NewClientModal] Error fetching client data:', error);
              alert(`Errore nel recuperare i dati del cliente: ${error.message}`);
              isCreatingClient.current = false;
              setPendingClientData(null);
              return;
            }

            if (data) {
              // Extract data based on client type
              let fullName = '';
              const email = data.email || '';
              const phone = data.telefono || '';

              if (data.tipo_cliente === 'persona_fisica') {
                fullName = `${data.nome || ''} ${data.cognome || ''}`.trim();
              } else if (data.tipo_cliente === 'azienda') {
                fullName = data.ragione_sociale || '';
              } else if (data.tipo_cliente === 'pubblica_amministrazione') {
                fullName = data.ente_ufficio || '';
              }

              console.log('[NewClientModal] Extracted client data:', { email, fullName, phone });
              console.log('[NewClientModal] Pending ticket numbers:', pendingTicketNumbers);

              // Store client data and verify pendingTicketNumbers is still set
              if (!pendingTicketNumbers || pendingTicketNumbers.length === 0) {
                console.error('[NewClientModal] ERROR: pendingTicketNumbers is empty!');
                alert('Errore: nessun biglietto selezionato. Riprova.');
                isCreatingClient.current = false;
                setShowNewClientModal(false);
                setPendingClientData(null);
                return;
              }

              // Store the actual client data
              setPendingClientData({ email, fullName, phone });

              // Close NewClientModal - onClose will NOT reset because isCreatingClient is true
              setShowNewClientModal(false);

              // Reset flag after modal closes
              isCreatingClient.current = false;

              // Open PaymentModal immediately after closing
              // Use setTimeout to ensure modal transition completes
              setTimeout(() => {
                console.log('[NewClientModal] Opening PaymentMethodModal');
                setShowPaymentModal(true);
              }, 50);
            }
          } catch (err) {
            console.error('[NewClientModal] Unexpected error:', err);
            isCreatingClient.current = false;
            setPendingClientData(null);
          }
        }}
      />

      {generatingPdf && (
        <div className="fixed inset-0 bg-theme-bg-primary bg-opacity-75 flex items-center justify-center z-50">
          <div className="bg-white rounded-full p-8 text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mx-auto mb-4"></div>
            <h3 className="text-xl font-bold mb-2">Generazione PDF in corso...</h3>
            <p className="text-gray-600">Invio email al cliente</p>
          </div>
        </div>
      )}

      {/* Search Results Modal */}
      {showSearchModal && searchResults.length > 0 && (
        <div className="fixed inset-0 bg-theme-bg-primary bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-full p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">
                Biglietti Trovati ({searchResults.length})
              </h3>
              <button
                onClick={() => {
                  setShowSearchModal(false);
                  setSearchResults([]);
                  setSearchEmail('');
                }}
                className="text-gray-500 hover:text-gray-700"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-3">
              {searchResults.map((ticket) => (
                <div key={ticket.ticket_number} className="border border-gray-300 rounded-full p-4 bg-gray-50">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-2xl font-bold text-blue-600">
                          #{String(ticket.ticket_number).padStart(4, '0')}
                        </span>
                        <span className="px-2 py-1 bg-red-100 text-red-700 text-xs font-semibold rounded">
                          VENDUTO
                        </span>
                      </div>
                      <div className="text-sm space-y-1">
                        <div><strong>Cliente:</strong> {ticket.full_name}</div>
                        <div><strong>Email:</strong> {ticket.email}</div>
                        {ticket.customer_phone && (
                          <div><strong>Telefono:</strong> {ticket.customer_phone}</div>
                        )}
                        <div><strong>Data Acquisto:</strong> {new Date(ticket.purchase_date).toLocaleString('it-IT')}</div>
                        <div className="text-xs text-gray-500">
                          <strong>ID Pagamento:</strong> {ticket.payment_intent_id}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleCancelTicket(ticket.ticket_number, ticket.email, ticket.full_name)}
                      className="ml-4 px-4 py-2 bg-red-600 text-theme-text-primary rounded-full hover:bg-red-700 font-semibold"
                    >
                      Cancella
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => {
                  setShowSearchModal(false);
                  setSearchResults([]);
                  setSearchEmail('');
                }}
                className="px-4 py-2 bg-gray-300 rounded-full hover:bg-gray-400"
              >
                Chiudi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ticket Details Modal */}
      {showTicketDetailsModal && selectedTicketForDetails && (
        <div className="fixed inset-0 bg-theme-bg-primary bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-full p-6 max-w-md w-full">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-gray-900">
                Biglietto #{String(selectedTicketForDetails.ticket_number).padStart(4, '0')}
              </h3>
              <button
                onClick={() => {
                  setShowTicketDetailsModal(false);
                  setSelectedTicketForDetails(null);
                }}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            </div>

            <div className="space-y-3 mb-6">
              <div className="bg-gray-50 p-3 rounded">
                <div className="text-sm text-gray-600">Cliente</div>
                <div className="font-semibold text-gray-900">{selectedTicketForDetails.full_name}</div>
              </div>
              <div className="bg-gray-50 p-3 rounded">
                <div className="text-sm text-gray-600">Email</div>
                <div className="font-semibold text-gray-900">{selectedTicketForDetails.email}</div>
              </div>
              {selectedTicketForDetails.customer_phone && (
                <div className="bg-gray-50 p-3 rounded">
                  <div className="text-sm text-gray-600">Telefono</div>
                  <div className="font-semibold text-gray-900">{selectedTicketForDetails.customer_phone}</div>
                </div>
              )}
              <div className="bg-gray-50 p-3 rounded">
                <div className="text-sm text-gray-600">Data Acquisto</div>
                <div className="font-semibold text-gray-900">
                  {new Date(selectedTicketForDetails.purchase_date).toLocaleString('it-IT')}
                </div>
              </div>
              {(selectedTicketForDetails as any).payment_method && (
                <div className="bg-gray-50 p-3 rounded">
                  <div className="text-sm text-gray-600">Metodo Pagamento</div>
                  <div className="font-semibold text-gray-900">{(selectedTicketForDetails as any).payment_method}</div>
                </div>
              )}
              <div className="bg-gray-50 p-3 rounded">
                <div className="text-sm text-gray-600">ID Pagamento</div>
                <div className="font-mono text-xs text-gray-700">{selectedTicketForDetails.payment_intent_id}</div>
              </div>
            </div>

            {/* Extended Customer Data Section */}
            {selectedTicketForDetails.customer_data && (
              <div className="mb-6">
                <h4 className="text-lg font-bold text-gray-900 mb-3 border-b pb-2">
                  Dati Cliente Completi
                </h4>
                <div className="space-y-2">
                  {selectedTicketForDetails.customer_data.tipo_cliente && (
                    <div className="bg-blue-50 p-3 rounded">
                      <div className="text-sm text-gray-600">Tipo Cliente</div>
                      <div className="font-semibold text-gray-900 capitalize">
                        {selectedTicketForDetails.customer_data.tipo_cliente.replace('_', ' ')}
                      </div>
                    </div>
                  )}

                  {/* Personal Data */}
                  {selectedTicketForDetails.customer_data.nome && (
                    <div className="bg-gray-50 p-3 rounded">
                      <div className="text-sm text-gray-600">Nome</div>
                      <div className="font-semibold text-gray-900">{selectedTicketForDetails.customer_data.nome}</div>
                    </div>
                  )}
                  {selectedTicketForDetails.customer_data.cognome && (
                    <div className="bg-gray-50 p-3 rounded">
                      <div className="text-sm text-gray-600">Cognome</div>
                      <div className="font-semibold text-gray-900">{selectedTicketForDetails.customer_data.cognome}</div>
                    </div>
                  )}
                  {selectedTicketForDetails.customer_data.data_nascita && (
                    <div className="bg-gray-50 p-3 rounded">
                      <div className="text-sm text-gray-600">Data di Nascita</div>
                      <div className="font-semibold text-gray-900">
                        {new Date(selectedTicketForDetails.customer_data.data_nascita).toLocaleDateString('it-IT')}
                      </div>
                    </div>
                  )}
                  {selectedTicketForDetails.customer_data.luogo_nascita && (
                    <div className="bg-gray-50 p-3 rounded">
                      <div className="text-sm text-gray-600">Luogo di Nascita</div>
                      <div className="font-semibold text-gray-900">{selectedTicketForDetails.customer_data.luogo_nascita}</div>
                    </div>
                  )}
                  {selectedTicketForDetails.customer_data.codice_fiscale && (
                    <div className="bg-gray-50 p-3 rounded">
                      <div className="text-sm text-gray-600">Codice Fiscale</div>
                      <div className="font-semibold text-gray-900 font-mono">{selectedTicketForDetails.customer_data.codice_fiscale}</div>
                    </div>
                  )}

                  {/* Address */}
                  {selectedTicketForDetails.customer_data.indirizzo && (
                    <div className="bg-gray-50 p-3 rounded">
                      <div className="text-sm text-gray-600">Indirizzo</div>
                      <div className="font-semibold text-gray-900">{selectedTicketForDetails.customer_data.indirizzo}</div>
                    </div>
                  )}
                  {selectedTicketForDetails.customer_data.citta && (
                    <div className="bg-gray-50 p-3 rounded">
                      <div className="text-sm text-gray-600">Città</div>
                      <div className="font-semibold text-gray-900">{selectedTicketForDetails.customer_data.citta}</div>
                    </div>
                  )}
                  {selectedTicketForDetails.customer_data.cap && (
                    <div className="bg-gray-50 p-3 rounded">
                      <div className="text-sm text-gray-600">CAP</div>
                      <div className="font-semibold text-gray-900">{selectedTicketForDetails.customer_data.cap}</div>
                    </div>
                  )}
                  {selectedTicketForDetails.customer_data.provincia && (
                    <div className="bg-gray-50 p-3 rounded">
                      <div className="text-sm text-gray-600">Provincia</div>
                      <div className="font-semibold text-gray-900">{selectedTicketForDetails.customer_data.provincia}</div>
                    </div>
                  )}

                  {/* Business Data */}
                  {selectedTicketForDetails.customer_data.ragione_sociale && (
                    <div className="bg-gray-50 p-3 rounded">
                      <div className="text-sm text-gray-600">Ragione Sociale</div>
                      <div className="font-semibold text-gray-900">{selectedTicketForDetails.customer_data.ragione_sociale}</div>
                    </div>
                  )}
                  {selectedTicketForDetails.customer_data.denominazione && (
                    <div className="bg-gray-50 p-3 rounded">
                      <div className="text-sm text-gray-600">Denominazione</div>
                      <div className="font-semibold text-gray-900">{selectedTicketForDetails.customer_data.denominazione}</div>
                    </div>
                  )}
                  {selectedTicketForDetails.customer_data.partita_iva && (
                    <div className="bg-gray-50 p-3 rounded">
                      <div className="text-sm text-gray-600">Partita IVA</div>
                      <div className="font-semibold text-gray-900 font-mono">{selectedTicketForDetails.customer_data.partita_iva}</div>
                    </div>
                  )}
                  {selectedTicketForDetails.customer_data.pec && (
                    <div className="bg-gray-50 p-3 rounded">
                      <div className="text-sm text-gray-600">PEC</div>
                      <div className="font-semibold text-gray-900">{selectedTicketForDetails.customer_data.pec}</div>
                    </div>
                  )}
                  {selectedTicketForDetails.customer_data.codice_sdi && (
                    <div className="bg-gray-50 p-3 rounded">
                      <div className="text-sm text-gray-600">Codice SDI</div>
                      <div className="font-semibold text-gray-900 font-mono">{selectedTicketForDetails.customer_data.codice_sdi}</div>
                    </div>
                  )}
                  {selectedTicketForDetails.customer_data.ente_ufficio && (
                    <div className="bg-gray-50 p-3 rounded">
                      <div className="text-sm text-gray-600">Ente/Ufficio</div>
                      <div className="font-semibold text-gray-900">{selectedTicketForDetails.customer_data.ente_ufficio}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Warning if no extended data */}
            {!selectedTicketForDetails.customer_data && (
              <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded">
                <div className="flex items-start gap-2">
                  <svg className="w-5 h-5 text-yellow-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div>
                    <div className="font-semibold text-yellow-800 text-sm">Dati Cliente Incompleti</div>
                    <div className="text-yellow-700 text-xs mt-1">
                      Questo biglietto non è collegato a un profilo cliente completo.
                      Il cliente potrebbe aver acquistato prima di creare un account completo.
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowTicketDetailsModal(false);
                  setSelectedTicketForDetails(null);
                }}
                className="flex-1 px-4 py-2 bg-gray-300 rounded-full hover:bg-gray-400 font-semibold"
              >
                Chiudi
              </button>
              <button
                onClick={() => {
                  if (confirm(`Sei sicuro di voler cancellare il biglietto #${String(selectedTicketForDetails.ticket_number).padStart(4, '0')} di ${selectedTicketForDetails.full_name}?`)) {
                    handleCancelTicket(selectedTicketForDetails.ticket_number, selectedTicketForDetails.email, selectedTicketForDetails.full_name);
                    setShowTicketDetailsModal(false);
                    setSelectedTicketForDetails(null);
                  }
                }}
                className="flex-1 px-4 py-2 bg-red-600 text-theme-text-primary rounded-full hover:bg-red-700 font-semibold"
              >
                Cancella Biglietto
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Email Template Editor Modal */}
      {showEmailEditorModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-theme-bg-secondary rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-theme-border flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold text-theme-text-primary">
                  Invia Email Clienti Lotteria
                </h2>
                <p className="text-sm text-theme-text-secondary mt-2">
                  Seleziona i destinatari e personalizza il contenuto dell'email
                </p>
              </div>
              <button
                onClick={() => setShowEmailEditorModal(false)}
                disabled={savingTemplate || sendingEmails}
                className="text-theme-text-muted hover:text-theme-text-primary text-3xl leading-none disabled:opacity-50 ml-4"
              >
                ×
              </button>
            </div>

            <div className="p-6 space-y-6">
              {loadingTemplate || loadingClients ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-dr7-gold mx-auto mb-4"></div>
                  <p className="text-theme-text-secondary">
                    {loadingTemplate ? 'Caricamento template...' : 'Caricamento clienti...'}
                  </p>
                </div>
              ) : (
                <>
                  {/* Recipient Selector */}
                  <div>
                    <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                      Invia a:
                    </label>
                    <div className="space-y-3">
                      {/* Search Input */}
                      <input
                        type="text"
                        placeholder="🔍 Cerca cliente per nome o email..."
                        value={clientSearchFilter}
                        onChange={(e) => setClientSearchFilter(e.target.value)}
                        className="w-full px-4 py-2 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary placeholder-gray-400 focus:outline-none focus:border-dr7-gold transition-colors"
                      />

                      {/* Client List with Checkboxes */}
                      <div className="border border-theme-border rounded-lg bg-theme-bg-tertiary max-h-[200px] overflow-y-auto">
                        {availableClients
                          .filter(client => {
                            if (!clientSearchFilter.trim()) return true;
                            const search = clientSearchFilter.toLowerCase();
                            return client.full_name.toLowerCase().includes(search) ||
                              client.email.toLowerCase().includes(search);
                          })
                          .map((client) => (
                            <label
                              key={client.email}
                              className="flex items-center px-4 py-2 hover:bg-theme-bg-hover cursor-pointer border-b border-theme-border last:border-b-0"
                            >
                              <input
                                type="checkbox"
                                checked={selectedRecipients.includes(client.email)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedRecipients([...selectedRecipients, client.email]);
                                  } else {
                                    setSelectedRecipients(selectedRecipients.filter(email => email !== client.email));
                                  }
                                }}
                                className="mr-3 w-4 h-4 accent-dr7-gold"
                              />
                              <div className="flex-1 text-sm">
                                <div className="text-theme-text-primary font-medium">{client.full_name}</div>
                                <div className="text-theme-text-muted text-xs">{client.email}</div>
                              </div>
                            </label>
                          ))}
                      </div>

                      {/* Status and Actions */}
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-theme-text-muted">
                          {selectedRecipients.length === 0
                            ? `Nessun cliente selezionato - invierà a TUTTI i ${availableClients.length} clienti`
                            : `${selectedRecipients.length} cliente${selectedRecipients.length > 1 ? 'i' : ''} selezionat${selectedRecipients.length > 1 ? 'i' : 'o'}`
                          }
                        </span>
                        {selectedRecipients.length > 0 && (
                          <button
                            onClick={() => setSelectedRecipients([])}
                            className="text-dr7-gold hover:text-yellow-500 font-medium"
                          >
                            Deseleziona Tutti
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Subject Field */}
                  <div>
                    <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                      Oggetto Email *
                    </label>
                    <input
                      type="text"
                      value={emailSubject}
                      onChange={(e) => setEmailSubject(e.target.value)}
                      className="w-full px-4 py-3 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors"
                      placeholder="Inserisci l'oggetto dell'email..."
                    />
                  </div>

                  {/* Email Content Field */}
                  <div>
                    <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                      Contenuto Email *
                    </label>
                    <textarea
                      value={emailTextContent}
                      onChange={(e) => setEmailTextContent(e.target.value)}
                      rows={12}
                      className="w-full px-4 py-3 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors resize-none"
                      placeholder="Inserisci il contenuto dell'email...\n\nEsempio:\nGentile Cliente,\n\nTi informiamo che...\n\nCordiali saluti,\nIl Team DR7 Empire"
                    />
                    <p className="text-xs text-theme-text-muted mt-2">
                      Scrivi il messaggio che verrà inviato a tutti i clienti che hanno acquistato biglietti
                    </p>
                  </div>
                </>
              )}
            </div>

            <div className="p-6 border-t border-theme-border flex gap-3 justify-end">
              <button
                onClick={() => setShowEmailEditorModal(false)}
                disabled={savingTemplate || sendingEmails}
                className="px-6 py-2 bg-gray-600 text-white rounded-full hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                Annulla
              </button>
              <button
                onClick={handleSaveEmailTemplate}
                disabled={savingTemplate || loadingTemplate || sendingEmails}
                className="px-6 py-2 bg-blue-600 text-white font-semibold rounded-full hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingTemplate ? 'Salvataggio...' : 'Salva Bozza'}
              </button>
              <button
                onClick={handleSendEmailsFromModal}
                disabled={savingTemplate || loadingTemplate || sendingEmails}
                className="px-6 py-2 bg-dr7-gold text-black font-semibold rounded-full hover:bg-yellow-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sendingEmails
                  ? 'Invio in corso...'
                  : selectedRecipients.length > 0
                    ? `Invia a ${selectedRecipients.length} Selezionat${selectedRecipients.length > 1 ? 'i' : 'o'}`
                    : 'Invia a Tutti'
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LotteriaBoard;
