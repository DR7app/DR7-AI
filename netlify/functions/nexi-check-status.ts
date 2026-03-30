import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Check status for pre-auth orders needs the explicit key
const NEXI_API_KEY = process.env.NEXI_API_KEY!;
const NEXI_BASE_URL = 'https://xpay.nexigroup.com/api/phoenix-0.0/psp/api/v1';

const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        const { orderId, mode } = JSON.parse(event.body || '{}');

        // Mode 'find_operation': search GET /operations to find operationId for an order
        if (mode === 'find_operation' && orderId) {
            const correlationId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                const r = Math.random() * 16 | 0
                return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
            })
            const fromTime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
            const toTime = new Date().toISOString()
            const url = `${NEXI_BASE_URL}/operations?fromTime=${encodeURIComponent(fromTime)}&toTime=${encodeURIComponent(toTime)}&maxRecords=500`
            console.log('[nexi-check-status] Searching operations for order:', orderId)
            const resp = await fetch(url, {
                headers: { 'X-Api-Key': NEXI_API_KEY, 'Correlation-Id': correlationId }
            })
            const text = await resp.text()
            let data: any
            try { data = JSON.parse(text) } catch {
                return { statusCode: 502, headers, body: JSON.stringify({ error: text.substring(0, 300) }) }
            }
            if (!resp.ok) {
                return { statusCode: resp.status, headers, body: JSON.stringify({ error: data.errors?.[0]?.description || 'API error', raw: data }) }
            }
            const allOps = data.operations || []
            // If orderId is 'all', return all uncaptured authorizations
            if (orderId === 'all') {
                // Group by orderId, find those with AUTH but no CAPTURE/VOID
                const byOrder: Record<string, any[]> = {}
                for (const op of allOps) { (byOrder[op.orderId] ||= []).push(op) }
                const uncaptured = []
                for (const [, opList] of Object.entries(byOrder)) {
                    const hasAuth = opList.some((o: any) => o.operationType === 'AUTHORIZATION' && o.operationResult === 'AUTHORIZED')
                    const hasCaptureOrVoid = opList.some((o: any) => ['CAPTURE', 'VOID', 'CANCEL', 'REFUND'].includes(o.operationType))
                    if (hasAuth && !hasCaptureOrVoid) {
                        uncaptured.push(opList.find((o: any) => o.operationType === 'AUTHORIZATION')!)
                    }
                }
                return { statusCode: 200, headers, body: JSON.stringify({ operations: uncaptured, totalScanned: allOps.length }) }
            }
            const ops = allOps.filter((op: any) => op.orderId === orderId)
            return { statusCode: 200, headers, body: JSON.stringify({ operations: ops, totalScanned: allOps.length }) }
        }

        if (!orderId) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'orderId is required' }) };
        }

        console.log('[nexi-check-status] Checking order:', orderId);

        // Call Nexi API to get real order status
        const correlationId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
        })

        const response = await fetch(`${NEXI_BASE_URL}/orders/${orderId}`, {
            method: 'GET',
            headers: {
                'X-Api-Key': NEXI_API_KEY,
                'Correlation-Id': correlationId
            }
        });

        const responseText = await response.text();
        console.log('[nexi-check-status] Response:', response.status, responseText.substring(0, 500));

        let responseData: any;
        try {
            responseData = JSON.parse(responseText);
        } catch {
            return {
                statusCode: 502,
                headers,
                body: JSON.stringify({ error: `Nexi API error (${response.status})` })
            };
        }

        if (!response.ok) {
            return {
                statusCode: response.status,
                headers,
                body: JSON.stringify({
                    error: responseData.errors?.[0]?.description || 'Failed to check status',
                    details: responseData
                })
            };
        }

        // Extract status from Nexi response
        const orderStatus = responseData.orderStatus?.lastOperationType || 'UNKNOWN';
        const lastOperation = responseData.orderStatus?.lastOperation || {};
        const operationResult = lastOperation.operationResult || 'UNKNOWN';
        const operationId = lastOperation.operationId || null;
        const operationAmount = lastOperation.operationAmount ? Number(lastOperation.operationAmount) / 100 : null;

        // Map to our status
        let status: string;
        if (operationResult === 'AUTHORIZED' && orderStatus === 'AUTHORIZATION') {
            status = 'preauthorized'; // Held, not captured
        } else if (operationResult === 'EXECUTED' && orderStatus === 'CAPTURE') {
            status = 'captured'; // Captured/charged
        } else if (operationResult === 'EXECUTED' && orderStatus === 'VOID') {
            status = 'voided'; // Cancelled/released
        } else if (operationResult === 'EXECUTED' && orderStatus === 'REFUND') {
            status = 'refunded';
        } else if (operationResult === 'DECLINED' || operationResult === 'DENIED') {
            status = 'declined';
        } else if (operationResult === 'PENDING') {
            status = 'pending';
        } else {
            status = operationResult.toLowerCase();
        }

        console.log('[nexi-check-status] Status:', status, '| orderStatus:', orderStatus, '| operationResult:', operationResult);

        // Update local DB
        await supabase
            .from('nexi_transactions')
            .update({
                status,
                metadata: { last_check: new Date().toISOString(), nexi_order_status: responseData.orderStatus }
            })
            .eq('order_id', orderId);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                orderId,
                status,
                operationId,
                operationResult,
                orderStatus,
                amount: operationAmount,
                isPreauthorized: status === 'preauthorized',
                isCaptured: status === 'captured',
                isVoided: status === 'voided' || status === 'refunded',
                raw: responseData.orderStatus
            }),
        };

    } catch (error: any) {
        console.error('[nexi-check-status] Error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message }),
        };
    }
};

export { handler };
