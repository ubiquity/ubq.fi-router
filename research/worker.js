addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const url = new URL(request.url)
  let address

  if (url.hostname === 'ubq.fi') {
    // Route root domain
    address = 'https://ubq-fi.pages.dev' + url.pathname + url.search
  } else {
    // Route subdomains
    const subdomains = url.hostname.split('.')

    if (subdomains.length === 3) {
      // Handle standard subdomain (e.g., pay.ubq.fi)
      const subdomain = subdomains[0]
      address = `https://${subdomain}-ubq-fi.pages.dev` + url.pathname + url.search
    } else {
      return new Response('Invalid subdomain format', { status: 400 })
    }
  }

  console.log(`Fetching address: ${address}`)
  return fetch(address, request)
}