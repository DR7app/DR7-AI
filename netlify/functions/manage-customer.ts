import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const handler: Handler = async (event) => {
  // CORS headers
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error("Missing Supabase credentials");
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Server configuration error" }),
    };
  }

  // Create admin client with service role
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { action, customerId, customerIds, status } = JSON.parse(event.body || "{}");

    if (!action) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Missing action parameter" }),
      };
    }

    // DELETE single customer
    if (action === "delete" && customerId) {
      console.log("[manage-customer] Deleting customer:", customerId);

      // Check if it's a temp ID (not a real customer in DB)
      if (customerId.startsWith("temp-")) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            message: "Temporary customer removed from view (not in database)",
          }),
        };
      }

      // First delete related records (before cascade might not work)
      console.log("[manage-customer] Deleting birthday_messages for:", customerId);
      const { error: birthdayError, count: birthdayCount } = await supabaseAdmin
        .from("birthday_messages")
        .delete()
        .eq("customer_id", customerId)
        .select();

      if (birthdayError) {
        console.error("Error deleting birthday_messages:", birthdayError);
      } else {
        console.log("[manage-customer] Deleted birthday_messages count:", birthdayCount);
      }

      console.log("[manage-customer] Deleting customer_memberships for:", customerId);
      const { error: membershipError } = await supabaseAdmin
        .from("customer_memberships")
        .delete()
        .eq("client_id", customerId);

      if (membershipError) {
        console.error("Error deleting customer_memberships:", membershipError);
      }

      // Cascade delete bookings and their children
      console.log("[manage-customer] Finding bookings for customer:", customerId);
      const { data: customerBookings } = await supabaseAdmin
        .from("bookings")
        .select("id")
        .eq("customer_id", customerId);

      if (customerBookings && customerBookings.length > 0) {
        const bookingIds = customerBookings.map(b => b.id);
        console.log("[manage-customer] Found", bookingIds.length, "bookings, deleting children...");

        // Delete children of each booking
        const { error: fattureError } = await supabaseAdmin
          .from("fatture")
          .delete()
          .in("booking_id", bookingIds);
        if (fattureError) console.warn("[manage-customer] Fatture deletion warning:", fattureError.message);

        const { error: contractsError } = await supabaseAdmin
          .from("contracts")
          .delete()
          .in("booking_id", bookingIds);
        if (contractsError) console.warn("[manage-customer] Contracts deletion warning:", contractsError.message);

        const { error: cauzioniError } = await supabaseAdmin
          .from("cauzioni")
          .delete()
          .in("booking_id", bookingIds);
        if (cauzioniError) console.warn("[manage-customer] Cauzioni deletion warning:", cauzioniError.message);

        // Delete bookings
        const { error: bookingsError } = await supabaseAdmin
          .from("bookings")
          .delete()
          .in("id", bookingIds);
        if (bookingsError) {
          console.error("Error deleting bookings:", bookingsError);
        } else {
          console.log("[manage-customer] Deleted", bookingIds.length, "bookings");
        }
      }

      // Delete from customers_extended
      console.log("[manage-customer] Deleting from customers_extended:", customerId);
      const { error: extError, count: extCount } = await supabaseAdmin
        .from("customers_extended")
        .delete()
        .eq("id", customerId)
        .select();

      if (extError) {
        console.error("Error deleting from customers_extended:", extError);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: "Failed to delete customer: " + extError.message }),
        };
      }
      console.log("[manage-customer] Deleted from customers_extended, count:", extCount);

      // Also delete from customers table for backward compatibility
      const { error: custError } = await supabaseAdmin
        .from("customers")
        .delete()
        .eq("id", customerId);

      if (custError) {
        console.warn("Error deleting from customers (may not exist):", custError);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: "Customer deleted",
          deletedBirthdays: birthdayCount || 0
        }),
      };
    }

    // UPDATE STATUS for single customer
    if (action === "updateStatus" && customerId) {
      console.log("[manage-customer] Updating status for:", customerId, "to:", status);

      if (customerId.startsWith("temp-")) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: "Cannot update status for temporary customer. Save the customer first.",
          }),
        };
      }

      const { error } = await supabaseAdmin
        .from("customers_extended")
        .update({ status: status, updated_at: new Date().toISOString() })
        .eq("id", customerId);

      if (error) {
        console.error("Error updating customer status:", error);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: error.message }),
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: "Status updated" }),
      };
    }

    // BULK UPDATE STATUS
    if (action === "bulkUpdateStatus" && customerIds && Array.isArray(customerIds)) {
      console.log("[manage-customer] Bulk updating status for", customerIds.length, "customers to:", status);

      // Filter out temp IDs
      const realIds = customerIds.filter((id: string) => !id.startsWith("temp-"));
      const tempCount = customerIds.length - realIds.length;

      if (realIds.length === 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: "All selected customers are temporary. Save them first.",
          }),
        };
      }

      const { error } = await supabaseAdmin
        .from("customers_extended")
        .update({ status: status, updated_at: new Date().toISOString() })
        .in("id", realIds);

      if (error) {
        console.error("Error bulk updating statuses:", error);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: error.message }),
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: `Status updated for ${realIds.length} customers`,
          skippedTemp: tempCount,
        }),
      };
    }

    // BULK DELETE
    if (action === "bulkDelete" && customerIds && Array.isArray(customerIds)) {
      console.log("[manage-customer] Bulk deleting", customerIds.length, "customers");

      const realIds = customerIds.filter((id: string) => !id.startsWith("temp-"));

      if (realIds.length > 0) {
        // Find all bookings for these customers
        const { data: allBookings } = await supabaseAdmin
          .from("bookings")
          .select("id")
          .in("customer_id", realIds);

        if (allBookings && allBookings.length > 0) {
          const bookingIds = allBookings.map(b => b.id);
          console.log("[manage-customer] Bulk delete: Found", bookingIds.length, "bookings, deleting children...");

          // Delete children of each booking
          const { error: fattureError } = await supabaseAdmin
            .from("fatture")
            .delete()
            .in("booking_id", bookingIds);
          if (fattureError) console.warn("[manage-customer] Bulk fatture deletion warning:", fattureError.message);

          const { error: contractsError } = await supabaseAdmin
            .from("contracts")
            .delete()
            .in("booking_id", bookingIds);
          if (contractsError) console.warn("[manage-customer] Bulk contracts deletion warning:", contractsError.message);

          const { error: cauzioniError } = await supabaseAdmin
            .from("cauzioni")
            .delete()
            .in("booking_id", bookingIds);
          if (cauzioniError) console.warn("[manage-customer] Bulk cauzioni deletion warning:", cauzioniError.message);

          // Delete bookings
          await supabaseAdmin.from("bookings").delete().in("id", bookingIds);
        }

        await supabaseAdmin.from("birthday_messages").delete().in("customer_id", realIds);
        await supabaseAdmin.from("customer_memberships").delete().in("client_id", realIds);
        await supabaseAdmin.from("customers_extended").delete().in("id", realIds);
        await supabaseAdmin.from("customers").delete().in("id", realIds);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: `Deleted ${realIds.length} customers`,
          skippedTemp: customerIds.length - realIds.length,
        }),
      };
    }

    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Invalid action or missing parameters" }),
    };
  } catch (error: any) {
    console.error("[manage-customer] Error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || "Internal server error" }),
    };
  }
};

export { handler };
