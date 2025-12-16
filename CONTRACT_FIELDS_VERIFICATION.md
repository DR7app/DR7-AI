# Contract Field Verification - New Template

## Template: CONTRATTO DI LOCAZIONE VEICOLO SENZA CONDUCENTE

This document verifies that all fields in the new simplified contract template are correctly mapped in the contract generation function.

---

## ✅ Contract Header

| Field | PDF Field Name | Mapped | Source |
|-------|---------------|---------|--------|
| Contratto n° | `ContractNumber`, `NumeroContratto` | ✅ | Generated as `CNT-{bookingId}` |
| Data di stipula | `Date`, `Data` | ✅ | Current date (Italian format) |
| Luogo di stipula | Pre-filled | ✅ | "Viale Marconi 229, CA, 09131" |
| Orario di stipula | `TimeOfIssue`, `OrarioStipula` | ✅ | Current time (HH:mm format) |

---

## ✅ DATI 1° GUIDATORE (First Driver)

| Field | PDF Field Name | Mapped | Source |
|-------|---------------|---------|--------|
| Nome & cognome | `CustomerName`, `NomeCognome` | ✅ | `customer.nome + cognome` or `booking.customer_name` |
| Codice Fiscale | `CodiceFiscale`, `PartitaIVA` | ✅ | `customer.codice_fiscale` |
| Sesso | `Sesso`, `CustomerSex` | ✅ | `customer.sesso` |
| Indirizzo + CAP | `Indirizzo`, `CAP` | ✅ | `customer.indirizzo`, `customer.codice_postale` |
| Città | `Citta`, `CustomerCity` | ✅ | `customer.citta_residenza` |
| Provincia | `Provincia`, `CustomerProvince` | ✅ | `customer.provincia_residenza` |
| Data di nascita | `DataNascita`, `CustomerBirthDate` | ✅ | `customer.data_nascita` |
| Città di nascita | `LuogoNascita`, `CittaNascita` | ✅ | `customer.luogo_nascita` |
| Provincia nascita | `CustomerBirthProvince` | ✅ | `customer.provincia_nascita` |
| Telefono | `Telefono`, `CustomerPhone` | ✅ | `booking.customer_phone` |
| E-mail | `Email`, `CustomerEmail` | ✅ | `booking.customer_email` |
| **Tipo di patente** | `TipoPatente`, `DriverLicenseType` | ✅ | `customer.tipo_patente` (default: 'B') |
| Numero patente | `NumeroPatente`, `DriverLicense` | ✅ | `customer.numero_patente` |
| Emessa da | `EmessaDa`, `DriverLicenseIssuedBy` | ✅ | `customer.emessa_da` |
| Data di rilascio | `DataRilascio`, `DriverLicenseIssueDate` | ✅ | `customer.data_rilascio_patente` |
| Scadenza | `Scadenza`, `DriverLicenseExpiryDate` | ✅ | `customer.scadenza_patente` |

---

## ✅ DATI 2° GUIDATORE (Second Driver)

All second driver fields are mapped from `booking.booking_details.second_driver`:
- Nome, Codice Fiscale, Sesso, Indirizzo, CAP, Città, Provincia
- Data di nascita, Città di nascita, Provincia nascita
- Telefono, E-mail
- Tipo patente, Numero, Emessa da, Data rilascio, Scadenza

---

## ✅ DATI AZIENDALI (Company Data - if applicable)

Pre-filled fields for business clients when `customer.tipo_cliente === 'azienda'`:
- Ragione sociale, E-mail aziendale, Sede legale, Telefono
- Codice fiscale / partita iva
- Nome e cognome (rappresentante legale)
- Numero carta d'identità, Data rilascio, Data scadenza, Luogo rilascio

---

## ✅ DATI DEL VEICOLO LOCATO (Rented Vehicle)

| Field | PDF Field Name | Mapped | Source |
|-------|---------------|---------|--------|
| Marca | `Marca`, `VehicleBrand` | ✅ | Parsed from `vehicle.make` or `vehicle_name` |
| Modello | `Modello`, `VehicleModel` | ✅ | Parsed from `vehicle.model` or `vehicle_name` |
| Targa | `Targa`, `VehiclePlate` | ✅ | `vehicle.plate` or `booking.vehicle_plate` |
| **Data di inizio** | `DataInizio`, `PickupDate` | ✅ | `booking.pickup_date` (Italian format) |
| **Ora di inizio** | `OraInizio`, `PickupTime` | ✅ | `booking.pickup_date` time (HH:mm) |
| Sede di ritiro | `SedeRitiro`, `PickupLocation` | ✅ | `booking.pickup_location` (default: Viale Marconi 229) |
| **Data di fine** | `DataFine`, `DropoffDate` | ✅ | `booking.dropoff_date` (Italian format) |
| **Ora di fine** | `OraFine`, `DropoffTime` | ✅ | `booking.dropoff_date` time (HH:mm) |
| Sede di riconsegna | `SedeRiconsegna`, `DropoffLocation` | ✅ | `booking.dropoff_location` (default: Viale Marconi 229) |
| **Assicurazione** | `Assicurazione`, `Insurance` | ✅ | `booking.booking_details.insurance` or `kasko` (default: 'RCA Base') |
| Sforo per KM | `SforoPerKM`, `KMOverageFee` | ✅ | `booking.km_overage_fee` |
| **Cauzione** | `Cauzione`, `Deposit` | ✅ | `booking.booking_details.deposit` or `cauzione` |
| **Km totali noleggio** | `KMTotaliNoleggio`, `TotalKM` | ✅ | `booking.booking_details.total_km` or `km_limit` (default: 'Illimitati') |

---

## ✅ DATI DR7 S.p.A. (Company Info)

Pre-filled in template:
- Ragione sociale: DR7 S.p.A
- E-mail aziendale: info@dr7.app
- Sede legale: Via del Fangario 25, 09122, Cagliari, CA
- Telefono: +39 345 790 5205
- Codice fiscale / partita iva: 04104640927

---

## Summary

### ✅ All Required Fields Mapped

All fields visible in the new contract template are now correctly mapped in the contract generation function (`netlify/functions/generate-contract.ts`).

### New Fields Added (Dec 16, 2025)

1. **Tipo di patente** - Driver license type (defaults to 'B')
2. **Data di inizio** - Pickup date
3. **Ora di inizio** - Pickup time
4. **Data di fine** - Dropoff date  
5. **Ora di fine** - Dropoff time
6. **Assicurazione** - Insurance type
7. **Cauzione** - Deposit amount
8. **Km totali noleggio** - Total rental kilometers

### Data Sources Priority

1. **Primary**: `customers_extended` table (most complete data)
2. **Fallback 1**: `customers` table (basic data)
3. **Fallback 2**: `booking.booking_details` (booking-specific data)
4. **Fallback 3**: Direct booking fields (`booking.customer_name`, etc.)

### Smart Parsing

The function includes intelligent parsing for:
- **Vehicle brand/model** - Extracted from vehicle name
- **Vehicle color** - Detected from name or metadata
- **Fuel type** - Inferred from vehicle type (defaults: Diesel for vans, Benzina for cars)
- **Seats** - Calculated based on vehicle type

---

## Testing Checklist

Before generating contracts, ensure:

- [ ] Customer has complete data in `customers_extended`
- [ ] Driver license details are filled (tipo, numero, emessa da, rilascio, scadenza)
- [ ] Vehicle has correct plate and details
- [ ] Booking has pickup/dropoff dates AND times
- [ ] Insurance type is specified in `booking_details`
- [ ] Deposit amount is set if applicable
- [ ] KM limit or overage fee is defined

---

**Last Updated**: December 16, 2025
**Template**: master_contract.pdf (Supabase Storage: `templates` bucket)
