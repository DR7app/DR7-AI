# Code Improver - Project Memory

## React Performance Patterns (DR7 Admin)

### Common Performance Issues Found
- **Inline setState with spread**: `setState({ ...state, field })` creates stale state risk. Always use functional form: `setState(prev => ({ ...prev, field }))`
- **Unmemoized filters in render**: Computing derived state (counters, filtered lists) on every render. Use `useMemo` with proper dependencies.
- **Missing useCallback**: Functions called from useEffect or passed as props should be wrapped in `useCallback`.
- **No loading states on async operations**: Always add loading state for save/submit buttons to prevent duplicate submissions.

### FleetInventory.tsx Specific Findings
- 20+ input fields with inline onChange handlers - functional updater critical for preventing lost keystrokes
- 5 summary counters filtering 50-100 vehicles on every render - memoize these
- Search filtering recomputes string transforms for every vehicle on every render - memoize
- Save button allows duplicate submissions - critical data corruption risk

## React 19 + TypeScript Project
- Uses Supabase for backend
- Large forms with many controlled inputs are common
- Fleet management UI with 50-100 vehicle records

## Delete Handler Audit (2026-02-13)

### SAFE Components (Correct Pattern)
- **CarWashTab.tsx**: ✅ Has modal with deleteTarget state
- **FatturaTab.tsx**: ✅ Has modal with deleteTarget state
- **MechanicalBookingTab.tsx**: ✅ Has modal with deleteTarget state
- **ContrattoTab.tsx**: ✅ Has modal with deleteTarget state
- **CarWashBookingsTab.tsx**: ✅ Has modal with deleteTarget state
- **VehiclesTab.tsx**: ✅ Has modal + full cascade deletion in deleteVehicleLogic()

### Components WITHOUT Delete Handlers
- **InvoicesTab.tsx**: No delete handlers (only removes form items, not DB records)
- **CauzioniTab.tsx**: No delete handlers (only status changes: restituita, sbloccata, incassata)
- **CustomersTab.tsx**: Uses Netlify function manage-customer (no frontend modal)

### Delete Handler Patterns Found
1. **Modal Pattern**: deleteTarget state + confirmDelete() function
2. **Cascade Pattern**: VehiclesTab queries by BOTH name AND id to find all related records
3. **Silent Failures**: Most catch blocks properly log + toast errors
4. **FK Cleanup**: VehiclesTab is the gold standard - deletes contracts → fatture → cauzioni → bookings
