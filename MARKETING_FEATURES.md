# Marketing Tab - Multi-Select & Multiple Images

## ✅ Already Implemented Features

### 1. Multi-Select Functionality
The Marketing tab already has full multi-select functionality:

- **Individual Selection**: Click on any customer row or checkbox to select/deselect
- **Select All**: Button to select all filtered customers
- **Select First 500**: Button to select first 500 customers (useful for large lists)
- **Deselect All**: Button appears when customers are selected to clear selection
- **Visual Feedback**: Selected customers have a gold highlight (`bg-dr7-gold/5`)
- **Counter**: Shows number of selected customers in the header

**Location**: `src/pages/admin/components/MarketingTab.tsx`
- Lines 331-335: Selection buttons
- Lines 345-363: Header checkbox (select all on current page)
- Lines 372-392: Individual customer checkboxes

### 2. Multiple Image Upload for Gift Vouchers
The GiftVoucherModal already supports uploading multiple images:

- **Multiple File Selection**: File input has `multiple` attribute (line 182)
- **Image Preview Grid**: Shows all uploaded images in a grid (lines 162-177)
- **Remove Images**: Each image has a remove button (lines 167-173)
- **File Validation**: 
  - Only accepts image files (JPEG/PNG)
  - Maximum 15MB total size
  - Shows error if non-image files are selected
- **Preview**: Shows thumbnails of all selected images before sending

**Location**: `src/pages/admin/components/GiftVoucherModal.tsx`
- Lines 19-46: Image upload handler with validation
- Lines 48-51: Remove image function
- Lines 154-199: Image upload UI with preview grid

## How to Use

### Multi-Select in Marketing Tab:
1. Go to Marketing tab
2. Use search to filter customers (optional)
3. Click "Seleziona Tutti" to select all filtered customers
4. OR click "Seleziona Primi 500" to select first 500
5. OR click individual checkboxes to select specific customers
6. Click "🎁 Invia Buono Regalo" button (enabled when customers are selected)

### Multiple Images in Gift Voucher:
1. Select customers in Marketing tab
2. Click "🎁 Invia Buono Regalo"
3. Choose Email channel
4. Click "📤 Carica Immagini (JPEG/PNG)" button
5. Select multiple images from your computer (Ctrl+Click or Cmd+Click)
6. All images will appear in the preview grid
7. Click X on any image to remove it
8. Fill in subject and message
9. Click "📧 Invia" to send

## Notes
- The multi-select works differently than the lottery board (always on, no toggle needed)
- Maximum 15MB total for all images combined
- Images are sent as email attachments to all selected customers
