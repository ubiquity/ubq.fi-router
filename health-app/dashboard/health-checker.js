// Client-side health checker with shared cache and rate limiting
class HealthChecker {
    constructor() {
        this.sessionId = Date.now() + '-' + Math.random().toString(36).substr(2, 9)
        this.checkedCount = 0
        this.totalCount = 0
        this.isChecking = false
        this.RATE_LIMIT_MS = 5 * 60 * 1000 // 5 minutes
    }

    async loadServices() {
        try {
            const response = await fetch('/health/services')
            if (!response.ok) throw new Error('Failed to fetch services list')
            return await response.json()
        } catch (error) {
            console.error('Error loading services:', error)
            throw error
        }
    }

    async loadCachedHealth() {
        try {
            const response = await fetch('/health/cache')
            if (!response.ok) throw new Error('Failed to fetch cached health')
            return await response.json()
        } catch (error) {
            console.error('Error loading cached health:', error)
            return { services: {}, plugins: {}, lastGlobalUpdate: new Date().toISOString() }
        }
    }

    shouldCheckService(key, lastChecked) {
        if (!lastChecked) return true

        // Check localStorage for recent checks by this browser
        const localKey = `health-check:${key}`
        const lastLocalCheck = localStorage.getItem(localKey)
        if (lastLocalCheck) {
            const timeSinceLocal = Date.now() - parseInt(lastLocalCheck)
            if (timeSinceLocal < this.RATE_LIMIT_MS) {
                return false // Skip - checked recently by this browser
            }
        }

        // Check if cached data is recent enough
        const timeSinceCached = Date.now() - new Date(lastChecked).getTime()
        return timeSinceCached > this.RATE_LIMIT_MS
    }

    async checkServiceHealth(domain) {
        try {
            const response = await fetch(`/health/proxy/status?domain=${domain}`)
            if (!response.ok) {
                return { healthy: false, status: 0, error: 'Proxy request failed' }
            }

            const result = await response.json()
            return {
                healthy: result.healthy,
                status: result.status,
                error: result.error
            }
        } catch (error) {
            return {
                healthy: false,
                status: 0,
                error: error.message.includes('timeout') ? 'Request timeout' : 'Connection failed'
            }
        }
    }

    async checkPluginManifest(domain) {
        try {
            const response = await fetch(`/health/proxy/manifest?domain=${domain}`)
            if (!response.ok) {
                return { manifestValid: false, status: 0, error: 'Proxy request failed' }
            }

            const result = await response.json()
            return {
                manifestValid: result.manifestValid,
                status: result.status,
                error: result.error
            }
        } catch (error) {
            return {
                manifestValid: false,
                status: 0,
                error: error.message.includes('timeout') ? 'Manifest timeout' : 'Manifest fetch failed'
            }
        }
    }

    async updateSharedCache(type, key, result) {
        try {
            const response = await fetch('/health/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type, key, result })
            })

            const responseData = await response.json()

            if (response.status === 202 && responseData.storage === 'fallback') {
                // KV limits hit - use localStorage fallback
                console.log('KV limits detected, switching to localStorage fallback')
                this.setLocalStorageMode(true)
                this.updateLocalStorageCache(type, key, result)
                return { storage: 'localStorage', success: true }
            }

            if (responseData.success && responseData.storage === 'deno-kv') {
                // KV is working - ensure we're not in fallback mode
                this.setLocalStorageMode(false)
                return { storage: 'deno-kv', success: true }
            }

            return responseData

        } catch (error) {
            console.error('Failed to update shared cache:', error)
            // Network error - fallback to localStorage
            this.setLocalStorageMode(true)
            this.updateLocalStorageCache(type, key, result)
            return { storage: 'localStorage', success: true, error: error.message }
        }
    }

    setLocalStorageMode(enabled) {
        localStorage.setItem('health-fallback-mode', enabled.toString())
        this.updateFallbackIndicator(enabled)
    }

    isLocalStorageMode() {
        return localStorage.getItem('health-fallback-mode') === 'true'
    }

    updateLocalStorageCache(type, key, result) {
        try {
            const cacheKey = `health-cache:${type}`
            const existingData = localStorage.getItem(cacheKey)
            let data = existingData ? JSON.parse(existingData) : {}

            data[key] = {
                ...result,
                lastChecked: new Date().toISOString(),
                storage: 'localStorage'
            }

            localStorage.setItem(cacheKey, JSON.stringify(data))
            localStorage.setItem('health-cache:lastUpdate', new Date().toISOString())
        } catch (error) {
            console.error('Failed to update localStorage cache:', error)
        }
    }

    getLocalStorageCache() {
        try {
            const services = localStorage.getItem('health-cache:service')
            const plugins = localStorage.getItem('health-cache:plugin')
            const lastUpdate = localStorage.getItem('health-cache:lastUpdate')

            return {
                services: services ? JSON.parse(services) : {},
                plugins: plugins ? JSON.parse(plugins) : {},
                lastGlobalUpdate: lastUpdate || new Date().toISOString()
            }
        } catch (error) {
            console.error('Failed to get localStorage cache:', error)
            return { services: {}, plugins: {}, lastGlobalUpdate: new Date().toISOString() }
        }
    }

    mergeHealthData(kvData, localData) {
        const merged = { ...kvData }

        // Merge localStorage data, preferring more recent entries
        Object.keys(localData).forEach(key => {
            const kvEntry = kvData[key]
            const localEntry = localData[key]

            if (!kvEntry) {
                // KV doesn't have this entry, use local
                merged[key] = localEntry
            } else if (localEntry.lastChecked) {
                // Both exist, use the more recent one
                const kvTime = new Date(kvEntry.lastChecked || 0).getTime()
                const localTime = new Date(localEntry.lastChecked).getTime()

                if (localTime > kvTime) {
                    merged[key] = localEntry
                }
            }
        })

        return merged
    }

    updateFallbackIndicator(isEnabled) {
        let indicator = document.getElementById('fallback-indicator')

        if (isEnabled && !indicator) {
            // Create fallback indicator
            indicator = document.createElement('div')
            indicator.id = 'fallback-indicator'
            indicator.innerHTML = `
                <div style="background: #7c2d12; border: 1px solid #ea580c; border-radius: 0.5rem; padding: 0.75rem; margin-bottom: 1rem; color: #fed7aa; text-align: center;">
                    <strong>Local Mode:</strong> Using browser storage due to server limits. Data will sync when server is available.
                </div>
            `
            document.querySelector('.container').insertBefore(indicator, document.querySelector('.header').nextSibling)
        } else if (!isEnabled && indicator) {
            // Remove fallback indicator
            indicator.remove()
        }
    }

    updateLocalStorage(key) {
        localStorage.setItem(`health-check:${key}`, Date.now().toString())
    }

    updateProgress() {
        const percentage = this.totalCount > 0 ? Math.round((this.checkedCount / this.totalCount) * 100) : 0
        document.getElementById('loading').innerHTML = `
            <p>Checking health status... (${this.checkedCount}/${this.totalCount} - ${percentage}%)</p>
            <div style="width: 100%; background: #334155; border-radius: 4px; margin-top: 1rem;">
                <div style="width: ${percentage}%; background: linear-gradient(135deg, #10b981, #3b82f6); height: 8px; border-radius: 4px; transition: width 0.3s;"></div>
            </div>
        `
    }

    createServiceCard(service, isChecking = false) {
        const lastChecked = service.lastChecked ? new Date(service.lastChecked).toLocaleTimeString() : 'Never'
        const checkingIndicator = isChecking ? '<span style="color: #fbbf24;">Checking...</span>' : ''

        return `
            <div class="service-card">
                <div class="card-header">
                    <div class="card-title">${service.name || 'root'} ${checkingIndicator}</div>
                    <div class="status-indicator ${service.healthy ? 'status-healthy' : 'status-unhealthy'}"></div>
                </div>
                <div class="card-domain">${service.domain}</div>
                <div class="card-details">
                    <div class="detail-item">
                        <span class="detail-label">Status:</span>
                        <span class="detail-value">${service.status || 'Unknown'}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Last Check:</span>
                        <span class="detail-value">${lastChecked}</span>
                    </div>
                </div>
                ${service.error ? `<div style="color: #ef4444; font-size: 0.75rem; margin-top: 0.5rem;">${service.error}</div>` : ''}
            </div>
        `
    }

    createPluginCard(plugin, isChecking = false) {
        const lastChecked = plugin.lastChecked ? new Date(plugin.lastChecked).toLocaleTimeString() : 'Never'
        const checkingIndicator = isChecking ? '<span style="color: #fbbf24;">Checking...</span>' : ''

        return `
            <div class="plugin-card">
                <div class="card-header">
                    <div class="card-title">${plugin.name} ${checkingIndicator}</div>
                    <div class="status-indicator ${plugin.healthy ? 'status-healthy' : 'status-unhealthy'}"></div>
                </div>
                <div class="card-domain">${plugin.domain}</div>
                <div class="card-details">
                    <div class="detail-item">
                        <span class="detail-label">Variant:</span>
                        <span class="detail-value">${plugin.variant}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Status:</span>
                        <span class="detail-value">${plugin.status || 'Unknown'}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Manifest:</span>
                        <span class="detail-value">${plugin.manifestValid ? 'Valid' : 'Invalid'}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Last Check:</span>
                        <span class="detail-value">${lastChecked}</span>
                    </div>
                </div>
                ${plugin.error ? `<div style="color: #ef4444; font-size: 0.75rem; margin-top: 0.5rem;">${plugin.error}</div>` : ''}
            </div>
        `
    }

    updateSummary(services, plugins) {
        const healthyServices = Object.values(services).filter(s => s.healthy).length
        const healthyPlugins = Object.values(plugins).filter(p => p.healthy).length
        const totalServices = Object.keys(services).length
        const totalPlugins = Object.keys(plugins).length
        const totalEntities = totalServices + totalPlugins
        const healthyEntities = healthyServices + healthyPlugins
        const overallHealth = totalEntities > 0 ? Math.round((healthyEntities / totalEntities) * 100) : 0

        document.getElementById('overall-health').textContent = `${overallHealth}%`
        document.getElementById('services-count').textContent = `${healthyServices}/${totalServices}`
        document.getElementById('plugins-count').textContent = `${healthyPlugins}/${totalPlugins}`
        document.getElementById('last-updated').textContent = new Date().toLocaleTimeString()
    }

    renderContent(services, plugins, checkingServices = new Set(), checkingPlugins = new Set()) {
        // Update services grid
        const servicesGrid = document.getElementById('services-grid')
        servicesGrid.innerHTML = Object.values(services)
            .map(service => this.createServiceCard(service, checkingServices.has(service.name)))
            .join('')

        // Update plugins grid
        const pluginsGrid = document.getElementById('plugins-grid')
        pluginsGrid.innerHTML = Object.values(plugins)
            .map(plugin => this.createPluginCard(plugin, checkingPlugins.has(plugin.name)))
            .join('')

        this.updateSummary(services, plugins)
    }

    showContent() {
        document.getElementById('loading').style.display = 'none'
        document.getElementById('error').style.display = 'none'
        document.getElementById('content').style.display = 'block'
    }

    showError(message) {
        document.getElementById('loading').style.display = 'none'
        document.getElementById('content').style.display = 'none'
        const errorDiv = document.getElementById('error')
        errorDiv.textContent = `Error: ${message}`
        errorDiv.style.display = 'block'
    }

    async runHealthChecks() {
        if (this.isChecking) return
        this.isChecking = true

        try {
            // Load services list and cached health data
            const [servicesList, cachedHealth] = await Promise.all([
                this.loadServices(),
                this.loadCachedHealth()
            ])

            let { services: cachedServices, plugins: cachedPlugins } = cachedHealth

            // If we're in localStorage mode, merge with local data
            if (this.isLocalStorageMode()) {
                const localData = this.getLocalStorageCache()
                cachedServices = this.mergeHealthData(cachedServices, localData.services)
                cachedPlugins = this.mergeHealthData(cachedPlugins, localData.plugins)
            }

            // Initialize missing entries
            servicesList.services.forEach(service => {
                const key = service || 'root'
                if (!cachedServices[key]) {
                    cachedServices[key] = {
                        name: key,
                        domain: service ? `${service}.ubq.fi` : 'ubq.fi',
                        healthy: false,
                        status: 0,
                        lastChecked: null
                    }
                }
            })

            servicesList.plugins.forEach(plugin => {
                const key = plugin.name + '-main'
                if (!cachedPlugins[key]) {
                    cachedPlugins[key] = {
                        name: plugin.name,
                        variant: 'main',
                        domain: plugin.routingDomain,
                        healthy: true, // Since these are from working plugin-map
                        status: 200,
                        manifestValid: true,
                        lastChecked: new Date().toISOString(),
                        displayName: plugin.displayName,
                        description: plugin.description
                    }
                }
            })

            // Show initial content
            this.showContent()
            this.renderContent(cachedServices, cachedPlugins)

            // Determine which services/plugins need checking
            const servicesToCheck = []
            const pluginsToCheck = []

            Object.entries(cachedServices).forEach(([key, service]) => {
                if (this.shouldCheckService(key, service.lastChecked)) {
                    servicesToCheck.push({ key, service })
                }
            })

            Object.entries(cachedPlugins).forEach(([key, plugin]) => {
                if (this.shouldCheckService(key, plugin.lastChecked)) {
                    pluginsToCheck.push({ key, plugin })
                }
            })

            this.totalCount = servicesToCheck.length + pluginsToCheck.length
            this.checkedCount = 0

            if (this.totalCount === 0) {
                console.log('All services up to date, skipping health checks')
                return
            }

            console.log(`Starting health checks for ${this.totalCount} items`)

            // Process checks in smaller batches to avoid overwhelming
            const batchSize = 5
            const allChecks = [...servicesToCheck.map(item => ({...item, type: 'service'})),
                             ...pluginsToCheck.map(item => ({...item, type: 'plugin'}))]

            for (let i = 0; i < allChecks.length; i += batchSize) {
                const batch = allChecks.slice(i, i + batchSize)

                await Promise.all(batch.map(async ({ key, service, plugin, type }) => {
                    try {
                        if (type === 'service') {
                            const checkingServices = new Set([service.name])
                            this.renderContent(cachedServices, cachedPlugins, checkingServices, new Set())

                            const healthResult = await this.checkServiceHealth(service.domain)
                            const updatedService = {
                                ...service,
                                ...healthResult,
                                lastChecked: new Date().toISOString(),
                                checkedBy: this.sessionId
                            }

                            cachedServices[key] = updatedService
                            await this.updateSharedCache('service', key, updatedService)
                            this.updateLocalStorage(key)
                        } else {
                            const checkingPlugins = new Set([plugin.name])
                            this.renderContent(cachedServices, cachedPlugins, new Set(), checkingPlugins)

                            const [healthResult, manifestResult] = await Promise.all([
                                this.checkServiceHealth(plugin.domain),
                                this.checkPluginManifest(plugin.domain)
                            ])

                            const updatedPlugin = {
                                ...plugin,
                                ...healthResult,
                                ...manifestResult,
                                healthy: healthResult.healthy && manifestResult.manifestValid,
                                lastChecked: new Date().toISOString(),
                                checkedBy: this.sessionId
                            }

                            cachedPlugins[key] = updatedPlugin
                            await this.updateSharedCache('plugin', key, updatedPlugin)
                            this.updateLocalStorage(key)
                        }

                        this.checkedCount++
                        this.updateProgress()
                        this.renderContent(cachedServices, cachedPlugins)

                    } catch (error) {
                        console.error(`Health check failed for ${key}:`, error)
                        this.checkedCount++
                        this.updateProgress()
                    }
                }))

                // Small delay between batches
                if (i + batchSize < allChecks.length) {
                    await new Promise(resolve => setTimeout(resolve, 100))
                }
            }

            console.log('Health checks completed')
            this.showContent()

        } catch (error) {
            console.error('Health check process failed:', error)
            this.showError(error.message)
        } finally {
            this.isChecking = false
        }
    }
}

// Initialize health checker
const healthChecker = new HealthChecker()

// Start health checks on page load
healthChecker.runHealthChecks()

// Manual refresh on overall health click
document.addEventListener('click', (e) => {
    if (e.target.id === 'overall-health') {
        healthChecker.runHealthChecks()
    }
})

// Auto refresh every 5 minutes (will be rate limited)
setInterval(() => {
    healthChecker.runHealthChecks()
}, 5 * 60 * 1000)
