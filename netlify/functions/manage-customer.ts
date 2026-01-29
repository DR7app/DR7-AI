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

      // Delete from customers_extended
      const { error: extError } = await supabaseAdmin
        .from("customers_extended")
        .delete()
        .eq("id", customerId);

      if (extError) {
        console.error("Error deleting from customers_extended:", extError);
      }

      // Also delete from customers table for backward compatibility
      const { error: custError } = await supabaseAdmin
        .from("customers")
        .delete()
        .eq("id", customerId);

      if (custError) {
        console.warn("Error deleting from customers (may not exist):", custError);
      }

      // Delete related records
      await supabaseAdmin.from("birthday_messages").delete().eq("customer_id", customerId);
      await supabaseAdmin.from("customer_memberships").delete().eq("client_id", customerId);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: "Customer deleted" }),
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
