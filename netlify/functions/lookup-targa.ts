import { Handler } from '@netlify/functions'

const OPENAPI_TOKEN = process.env.OPENAPI_AUTOMOTIVE_TOKEN || ''

export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  try {
    const { targa } = JSON.parse(event.body || '{}')

    if (!targa || typeof targa !== 'string' || targa.length < 5) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Targa non valida' }) }
    }

    const cleanTarga = targa.toUpperCase().replace(/[\s\-]/g, '')

    if (!OPENAPI_TOKEN) {
      console.error('[lookup-targa] OPENAPI_AUTOMOTIVE_TOKEN not configured')
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Servizio temporaneamente non disponibile.' }),
      }
    }

    console.log('[lookup-targa] Looking up plate:', cleanTarga)
    console.log('[lookup-targa] Token present:', !!OPENAPI_TOKEN, 'length:', OPENAPI_TOKEN.length, 'starts:', OPENAPI_TOKEN.substring(0, 4))

    const response = await fetch(`https://automotive.openapi.com/IT-car/${cleanTarga}`, {
      headers: { 'Authorization': `Bearer ${OPENAPI_TOKEN}` },
    })

    console.log('[lookup-targa] API status:', response.status)

    if (response.status === 404) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Targa non trovata' }) }
    }

    if (!response.ok) {
      const errBody = await response.text().catch(() => '')
      console.error('[lookup-targa] API error:', response.status, errBody)
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: `Errore API (${response.status}): ${errBody || 'Riprova.'}` }),
      }
    }

    const json = await response.json()

    // API returns { success: true, data: { ... } }
    if (!json.success || !json.data) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Targa non trovata' }) }
    }

    const car = json.data

    console.log('[lookup-targa] Success:', car.CarMake, car.CarModel)

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        targa: cleanTarga,
        brand: car.CarMake || '',
        model: car.CarModel || '',
        makeModel: ((car.CarMake || '') + ' ' + (car.CarModel || '')).trim(),
        description: car.Description || '',
        year: car.RegistrationYear || '',
        fuel: car.FuelType || '',
        powerCV: car.PowerCV || '',
        displacement: car.EngineSize || '',
        doors: car.NumberOfDoors || '',
      }),
    }
  } catch (error: any) {
    console.error('[lookup-targa] error:', error.message)
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Errore: ' + error.message }),
    }
  }
}
