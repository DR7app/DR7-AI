"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var supabase_js_1 = require("@supabase/supabase-js");
var dotenv = require("dotenv");
dotenv.config();
var supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co';
var supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
if (!supabaseServiceKey) {
    console.error('Missing SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_ANON_KEY');
    process.exit(1);
}
var supabase = (0, supabase_js_1.createClient)(supabaseUrl, supabaseServiceKey);
function debugLatestBooking() {
    return __awaiter(this, void 0, void 0, function () {
        var _a, bookings, error, bookingWithDriver, sd, secondDriverName;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    console.log('Fetching latest booking with second driver data...');
                    return [4 /*yield*/, supabase
                            .from('bookings')
                            .select('*')
                            .order('created_at', { ascending: false })
                            .limit(20)];
                case 1:
                    _a = _b.sent(), bookings = _a.data, error = _a.error;
                    if (error) {
                        console.error('Error fetching bookings:', error);
                        return [2 /*return*/];
                    }
                    if (!bookings || bookings.length === 0) {
                        console.log('No bookings found.');
                        return [2 /*return*/];
                    }
                    bookingWithDriver = bookings.find(function (b) {
                        return b.booking_details &&
                            b.booking_details.second_driver &&
                            (b.booking_details.second_driver.name || b.booking_details.second_driver.nome);
                    });
                    if (!bookingWithDriver) {
                        console.log('No recent bookings found with second driver data.');
                        console.log('Checked the last 20 bookings.');
                        return [2 /*return*/];
                    }
                    console.log("FOUND BOOKING ID: ".concat(bookingWithDriver.id));
                    console.log('--- BOOKING DETAILS (Raw JSON) ---');
                    console.log(JSON.stringify(bookingWithDriver.booking_details, null, 2));
                    console.log('--- SECOND DRIVER DATA ANALYSIS ---');
                    sd = bookingWithDriver.booking_details.second_driver;
                    console.log('Keys present in second_driver object:', Object.keys(sd));
                    console.log('Name check:', sd.name || sd.nome || 'MISSING');
                    console.log('Surname check:', sd.surname || sd.cognome || 'MISSING');
                    console.log('Tax Code check:', sd.tax_code || sd.codice_fiscale || 'MISSING');
                    console.log('City check:', sd.city || sd.citta || 'MISSING');
                    // Simulate the logic from generate-contract.ts
                    console.log('--- SIMULATED CONTRACT MAPPING ---');
                    secondDriverName = ((sd === null || sd === void 0 ? void 0 : sd.name) && (sd === null || sd === void 0 ? void 0 : sd.surname)) ? "".concat(sd.name, " ").concat(sd.surname) : 'FAILED LOGIC';
                    console.log("SecondDriverName would be: \"".concat(secondDriverName, "\""));
                    return [2 /*return*/];
            }
        });
    });
}
debugLatestBooking();
