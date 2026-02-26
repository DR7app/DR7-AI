import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'POST only' }) }
  }

  const results: string[] = []

  // Set price_unit for quantity selector
  const qtyServices = ['CHILD CARE', 'ENGINE CLEAN', 'SEAT CLEAN', 'SEAT PROTECT', 'ODOR CONTROL']
  for (const name of qtyServices) {
    const { error } = await supabase
      .from('car_wash_services')
      .update({ price_unit: 'Qtà' })
      .ilike('name', `%${name}%`)
    results.push(`${name} price_unit: ${error ? error.message : 'OK'}`)
  }

  // Courtesy Drive price options
  const { error: e1 } = await supabase
    .from('car_wash_services')
    .update({ price_options: [
      { label: '3h', price: 19.90 },
      { label: '4h', price: 23.60 },
      { label: '5h', price: 29.50 },
      { label: '6h', price: 35.40 },
      { label: '7h', price: 41.30 }
    ]})
    .ilike('name', '%COURTESY DRIVE%')
  results.push(`COURTESY DRIVE options: ${e1 ? e1.message : 'OK'}`)

  // Supercar Experience price options
  const { error: e2 } = await supabase
    .from('car_wash_services')
    .update({ price_options: [
      { label: '3h', price: 189 },
      { label: '4h', price: 276 },
      { label: '5h', price: 345 },
      { label: '6h', price: 414 },
      { label: '7h', price: 483 }
    ]})
    .ilike('name', '%SUPERCAR EXPERIENCE%')
  results.push(`SUPERCAR EXPERIENCE options: ${e2 ? e2.message : 'OK'}`)

  // Icon Experience price options
  const { error: e3 } = await supabase
    .from('car_wash_services')
    .update({ price_options: [
      { label: '1h', price: 149 },
      { label: '2h', price: 249 },
      { label: '3h', price: 289 },
      { label: '4h', price: 356 },
      { label: '5h', price: 445 },
      { label: '6h', price: 534 },
      { label: '7h', price: 623 }
    ]})
    .ilike('name', '%ICON EXPERIENCE%')
  results.push(`ICON EXPERIENCE options: ${e3 ? e3.message : 'OK'}`)

  return {
    statusCode: 200,
    body: JSON.stringify({ results })
  }
}
