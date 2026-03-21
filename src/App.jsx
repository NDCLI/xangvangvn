import { startTransition, useCallback, useEffect, useState } from 'react'
import './App.css'

const REFRESH_INTERVAL_MS = 120000
const PETROLIMEX_BACNINH_PRICE_REQUEST = {
  FilterBy: {
    And: [
      { SystemID: { Equals: '6783dc1271ff449e95b74a9520964169' } },
      { RepositoryID: { Equals: 'a95451e23b474fe5886bfb7cf843f53c' } },
      { RepositoryEntityID: { Equals: '3801378fe1e045b1afa10de7c5776124' } },
      { Status: { Equals: 'Published' } },
    ],
  },
  SortBy: { LastModified: 'Descending' },
  Pagination: { TotalRecords: -1, TotalPages: 0, PageSize: 0, PageNumber: 0 },
}
const PROXY_BUILDERS = [
  (targetUrl) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`,
  (targetUrl) => `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
  (targetUrl) => `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`,
]

function normalizeText(value) {
  return value.replace(/\s+/g, ' ').trim()
}

function parseNumericPrice(value) {
  return Number(value.replace(/[^\d]/g, ''))
}

function normalizeFuelName(value) {
  return normalizeText(value)
    .replace(/^Dầu\s+/i, '')
    .replace(/^DO\s+/i, 'DO ')
    .replace(/\s+/g, ' ')
    .trim()
}

function formatNumber(value) {
  return new Intl.NumberFormat('vi-VN').format(value)
}

function formatSyncTime(timestamp) {
  if (!timestamp) {
    return '--:--:--'
  }

  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(timestamp)
}

function encodeBase64Url(value) {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function buildPetrolimexBacNinhFuelUrl() {
  const request = encodeBase64Url(JSON.stringify(PETROLIMEX_BACNINH_PRICE_REQUEST))
  return `https://bacninh.petrolimex.com.vn/~apis/portals/cms.item/search?object-identity=search&x-request=${request}`
}

function formatFriendlyDateTime(timestamp) {
  if (!timestamp) {
    return '--:-- - --/--/----'
  }

  const date = new Date(timestamp)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()

  return `${hours}:${minutes} - ${day}/${month}/${year}`
}

async function fetchHtmlWithFallback(targetUrl) {
  const failures = []

  for (const buildProxyUrl of PROXY_BUILDERS) {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 12000)

    try {
      const response = await fetch(buildProxyUrl(targetUrl), {
        signal: controller.signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      return await response.text()
    } catch (error) {
      failures.push(error instanceof Error ? error.message : 'Lỗi không xác định')
    } finally {
      window.clearTimeout(timeoutId)
    }
  }

  throw new Error(`Không thể đồng bộ dữ liệu. Chi tiết: ${failures.join(' | ')}`)
}

async function fetchJsonWithFallback(targetUrl) {
  const failures = []

  for (const buildProxyUrl of PROXY_BUILDERS) {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 12000)

    try {
      const response = await fetch(buildProxyUrl(targetUrl), {
        signal: controller.signal,
        headers: {
          Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
        },
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      return await response.json()
    } catch (error) {
      failures.push(error instanceof Error ? error.message : 'Lỗi không xác định')
    } finally {
      window.clearTimeout(timeoutId)
    }
  }

  throw new Error(`Không thể đồng bộ dữ liệu. Chi tiết: ${failures.join(' | ')}`)
}

function parseGoldData(html) {
  const documentNode = new DOMParser().parseFromString(html, 'text/html')
  const table =
    documentNode.querySelector('#container-gia table') ||
    documentNode.querySelector('table')

  if (!table) {
    throw new Error('Không tìm thấy bảng giá vàng Sinh Diễn.')
  }

  const rows = [...table.querySelectorAll('tbody tr')]
    .map((row) => {
      const cells = [...row.querySelectorAll('td')].map((cell) => normalizeText(cell.textContent || ''))
      if (cells.length < 3) return null
      return {
        product: cells[0],
        buyText: cells[1],
        sellText: cells[2],
        buyValue: parseNumericPrice(cells[1]),
        sellValue: parseNumericPrice(cells[2]),
      }
    })
    .filter(Boolean)

  if (rows.length === 0) {
    throw new Error('Không đọc được dòng giá vàng từ Sinh Diễn.')
  }

  const primaryRow =
    rows.find((r) => r.product.includes('SDJ')) ||
    rows.find((r) => r.product.includes('SD')) ||
    rows[0]

  const footerText = normalizeText(documentNode.querySelector('.footer-gia')?.textContent || '')
  const timeMatch = footerText.match(/(\d+h\d*)\s*ngày\s*(\d+\/\d+\/\d+)/i)
  const buyValue = primaryRow.buyValue
  const sellValue = primaryRow.sellValue

  return {
    source: 'Vàng Sinh Diễn',
    title: 'Bảng giá vàng Sinh Diễn',
    product: primaryRow.product,
    region: 'Bắc Ninh',
    buyValue,
    sellValue,
    buyText: primaryRow.buyText,
    sellText: primaryRow.sellText,
    spreadValue: sellValue - buyValue,
    updatedText: timeMatch ? `${timeMatch[1]} ngày ${timeMatch[2]}` : 'Theo cập nhật mới nhất từ nguồn',
    unit: 'đồng/lượng',
    items: rows,
  }
}

function getPetrolimexUpdatedTime(items) {
  const latestTimestamp = items.reduce((latest, item) => {
    const value = new Date(item.LastModified).getTime()
    return Number.isNaN(value) ? latest : Math.max(latest, value)
  }, 0)

  if (!latestTimestamp) {
    return null
  }

  const time = new Date(latestTimestamp)
  let hours = time.getHours()
  let minutes = time.getMinutes()

  if (minutes > 50) {
    hours += 1
    if (hours > 24) {
      hours = 0
    }
    minutes = 0
  } else {
    hours = hours > 13 && hours < 17 ? 15 : hours >= 17 && hours < 19 ? 17 : hours >= 19 && hours < 21 ? 19 : hours
    minutes = minutes >= 45 ? 45 : minutes >= 30 ? 30 : minutes >= 15 ? 15 : 0
  }

  time.setHours(hours)
  time.setMinutes(minutes)
  time.setSeconds(0)
  time.setMilliseconds(0)

  return time
}

function parseFuelChangeData(html) {
  const documentNode = new DOMParser().parseFromString(html, 'text/html')
  const table = [...documentNode.querySelectorAll('table')].find((candidate) => {
    const text = normalizeText(candidate.textContent || '')
    return text.includes('Xăng RON') || text.includes('Dầu DO') || text.includes('Xăng E5')
  })

  if (!table) {
    return new Map()
  }

  return new Map(
    [...table.querySelectorAll('tbody tr')]
      .map((row) => {
        const cells = [...row.querySelectorAll('td')].map((cell) => normalizeText(cell.textContent || ''))

        if (cells.length < 4) {
          return null
        }

        const hasIndex = /^\d+$/.test(cells[0])
        const nameIdx = hasIndex ? 1 : 0
        const changeIdx = hasIndex ? 3 : 2
        const name = normalizeFuelName(cells[nameIdx] || '')
        const changeText = cells[changeIdx] || ''

        if (!name || !changeText) {
          return null
        }

        return [name, changeText]
      })
      .filter(Boolean),
  )
}

function parseFuelData(data, changeByName = new Map()) {
  const objects = Array.isArray(data?.Objects) ? data.Objects : []

  if (objects.length === 0) {
    throw new Error('Không đọc được bảng giá xăng dầu từ Petrolimex.')
  }

  const items = [...objects]
    .sort((left, right) => {
      const leftOrder = Number(left.DIsplayOrder ?? left.OrderIndex ?? 0)
      const rightOrder = Number(right.DIsplayOrder ?? right.OrderIndex ?? 0)
      return leftOrder - rightOrder
    })
    .map((item) => ({
      name: normalizeText(item.Title || item.EnglishTitle || ''),
      priceValue: Number(item.Zone1Price || 0),
      changeText: changeByName.get(normalizeFuelName(item.Title || item.EnglishTitle || '')) || '--',
    }))
    .filter((item) => item.name && item.priceValue > 0)

  if (items.length === 0) {
    throw new Error('Không đọc được giá bán lẻ xăng dầu từ Petrolimex.')
  }

  return {
    source: 'Petrolimex',
    title: 'Bảng giá xăng dầu trong nước',
    effectiveText: formatFriendlyDateTime(getPetrolimexUpdatedTime(objects)),
    items,
  }
}

async function loadVietnamesePrices() {
  const [goldHtml, fuelData, fuelChangeHtml] = await Promise.all([
    fetchHtmlWithFallback('https://vangsinhdien.com/'),
    fetchJsonWithFallback(buildPetrolimexBacNinhFuelUrl()),
    fetchHtmlWithFallback('https://www.pvoil.com.vn/tin-gia-xang-dau'),
  ])

  const fuelChanges = parseFuelChangeData(fuelChangeHtml)

  return {
    gold: parseGoldData(goldHtml),
    fuel: parseFuelData(fuelData, fuelChanges),
  }
}

function App() {
  const [marketData, setMarketData] = useState({ gold: null, fuel: null })
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [lastSyncedAt, setLastSyncedAt] = useState(null)
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL_MS / 1000)

  const refreshData = useCallback(async ({ silent = false } = {}) => {
    if (silent) {
      setIsRefreshing(true)
    } else {
      setIsLoading(true)
    }

    try {
      const latestData = await loadVietnamesePrices()

      startTransition(() => {
        setMarketData(latestData)
        setError('')
        setLastSyncedAt(Date.now())
        setCountdown(REFRESH_INTERVAL_MS / 1000)
      })
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Không thể đồng bộ dữ liệu.')
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    refreshData()

    const refreshTimer = window.setInterval(() => {
      refreshData({ silent: true })
    }, REFRESH_INTERVAL_MS)

    const countdownTimer = window.setInterval(() => {
      setCountdown((current) => (current <= 1 ? REFRESH_INTERVAL_MS / 1000 : current - 1))
    }, 1000)

    return () => {
      window.clearInterval(refreshTimer)
      window.clearInterval(countdownTimer)
    }
  }, [refreshData])

  return (
    <main className="dashboard-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="hero-kicker">Công cụ theo dõi giá vàng và xăng dầu trong nước</p>
        </div>

        <div className="hero-meta">
          <div className="status-card">
            <span className={`status-dot ${error ? 'error' : isRefreshing ? 'refreshing' : 'live'}`}></span>
            <div>
              <p>Trạng thái</p>
              <strong>
                {error ? 'Đồng bộ thất bại' : isRefreshing ? 'Đang đồng bộ lại' : 'Đang theo dõi'}
              </strong>
            </div>
          </div>

          <div className="status-grid">
            <div>
              <p>Lần đồng bộ gần nhất</p>
              <strong>{formatSyncTime(lastSyncedAt)}</strong>
            </div>
            <div>
              <p>Làm mới sau</p>
              <strong>{countdown}s</strong>
            </div>
          </div>

          <button className="refresh-button" onClick={() => refreshData({ silent: true })}>
            {isRefreshing ? 'Đang cập nhật...' : 'Cập nhật ngay'}
          </button>
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="content-grid">
        <article className="panel panel-gold">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Nguồn: {marketData.gold?.source ?? 'Vàng Sinh Diễn'}</p>
              <h2>Giá vàng Sinh Diễn</h2>
            </div>
            <span className="source-chip">Trong nước</span>
          </div>

          {isLoading && !marketData.gold ? (
            <div className="loading-stack">
              <div className="skeleton skeleton-title"></div>
              <div className="skeleton skeleton-price"></div>
              <div className="skeleton skeleton-stats"></div>
            </div>
          ) : (
            marketData.gold && (
              <>
                <div className="gold-price-grid">
                  <div className="price-box">
                    <p>Giá mua vào</p>
                    <strong>{formatNumber(marketData.gold.buyValue)}</strong>
                    <span>{marketData.gold.unit}</span>
                  </div>
                  <div className="price-box emphasis">
                    <p>Giá bán ra</p>
                    <strong>{formatNumber(marketData.gold.sellValue)}</strong>
                    <span>{marketData.gold.unit}</span>
                  </div>
                </div>

                <dl className="detail-list">
                  <div>
                    <dt>Sản phẩm</dt>
                    <dd>{marketData.gold.product}</dd>
                  </div>
                  <div>
                    <dt>Khu vực</dt>
                    <dd>{marketData.gold.region}</dd>
                  </div>
                  <div>
                    <dt>Chênh lệch mua bán</dt>
                    <dd>{formatNumber(marketData.gold.spreadValue)} {marketData.gold.unit}</dd>
                  </div>
                  <div>
                    <dt>Cập nhật nguồn</dt>
                    <dd>{marketData.gold.updatedText}</dd>
                  </div>
                </dl>

                <div className="gold-table-wrap">
                  <table className="gold-table">
                    <thead>
                      <tr>
                        <th>Loại vàng</th>
                        <th>Mua vào</th>
                        <th>Bán ra</th>
                      </tr>
                    </thead>
                    <tbody>
                      {marketData.gold.items.map((item) => (
                        <tr key={item.product}>
                          <td className="gold-name">{item.product}</td>
                          <td>{formatNumber(item.buyValue)} đ</td>
                          <td>{formatNumber(item.sellValue)} đ</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )
          )}
        </article>

        <article className="panel panel-fuel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Nguồn: {marketData.fuel?.source ?? 'Petrolimex'}</p>
              <h2>Giá xăng dầu</h2>
            </div>
            <span className="source-chip">Niêm yết nội địa</span>
          </div>

          {isLoading && !marketData.fuel ? (
            <div className="loading-stack">
              <div className="skeleton skeleton-title"></div>
              <div className="skeleton skeleton-chart"></div>
              <div className="skeleton skeleton-stats"></div>
            </div>
          ) : (
            marketData.fuel && (
              <>
                <p className="fuel-effective">Áp dụng từ: {marketData.fuel.effectiveText}</p>
                <div className="fuel-table-wrap">
                  <table className="fuel-table">
                    <thead>
                      <tr>
                        <th>Loại xăng / dầu</th>
                        <th>Giá bán lẻ</th>
                        <th>Biến động</th>
                      </tr>
                    </thead>
                    <tbody>
                      {marketData.fuel.items.map((item) => (
                        <tr key={item.name}>
                          <td className="fuel-name">{item.name}</td>
                          <td>{formatNumber(item.priceValue)} đ</td>
                          <td className={item.changeText.startsWith('+') ? 'up' : item.changeText.startsWith('-') ? 'down' : ''}>
                            {item.changeText}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )
          )}
        </article>
      </section>


    </main>
  )
}

export default App
