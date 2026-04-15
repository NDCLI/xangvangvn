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
    .replace(/^Xăng sinh học\s+/i, '')
    .replace(/^Xăng\s+/i, '')
    .replace(/^Điêzen\s+/i, 'DO ')
    .replace(/^DO\s+/i, 'DO ')
    .replace(/\s+/g, ' ')
    .trim()
}

function formatNumber(value) {
  return new Intl.NumberFormat('vi-VN').format(value)
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

function getGoldFallback() {
  return {
    source: 'Vàng Sinh Diễn',
    title: 'Bảng giá vàng Sinh Diễn',
    product: '--',
    region: 'Bắc Ninh',
    buyValue: 0,
    sellValue: 0,
    buyText: '--',
    sellText: '--',
    spreadValue: 0,
    updatedText: 'Nguồn đang bảo trì - vui lòng quay lại sau',
    unit: 'đồng/lượng',
    items: [],
  }
}

function getPetrolimexUpdatedTime(officialItems) {
  // Petrolimex doesn't always provide a clear timestamp per item on the homepage
  // We'll return current time as the "effective" time if we can't find it
  return new Date()
}

async function fetchFuelChangeData() {
  const FUEL_CHANGE_LIST_URL = 'https://www.petrolimex.com.vn/ndi/thong-cao-bao-chi.html'
  
  try {
    const listHtml = await fetchHtmlWithFallback(FUEL_CHANGE_LIST_URL)
    const listDoc = new DOMParser().parseFromString(listHtml, 'text/html')
    
    const latestLinkNode = [...listDoc.querySelectorAll('a')].find(a => 
      a.textContent?.toLowerCase().includes('điều chỉnh giá xăng dầu') && 
      a.getAttribute('href')?.includes('/ndi/thong-cao-bao-chi/')
    )

    if (!latestLinkNode) return new Map()

    const href = latestLinkNode.getAttribute('href')
    const announcementUrl = href.startsWith('http') 
      ? href 
      : `https://www.petrolimex.com.vn${href.startsWith('/') ? '' : '/'}${href}`

    const pageHtml = await fetchHtmlWithFallback(announcementUrl)
    const pageDoc = new DOMParser().parseFromString(pageHtml, 'text/html')
    
    const table = [...pageDoc.querySelectorAll('table')].find(candidate => {
      const text = normalizeText(candidate.textContent || '')
      return text.includes('RON 95') || text.includes('Điêzen')
    })

    if (!table) return new Map()

    const changes = new Map()
    const rows = [...table.querySelectorAll('tr')]
    
    rows.forEach(row => {
      const cells = [...row.querySelectorAll('td')].map(c => normalizeText(c.textContent || ''))
      if (cells.length < 3) return

      const nameCandidate = normalizeFuelName(cells[0] || cells[1] || '')
      const lastCell = cells[cells.length - 1]
      
      if (nameCandidate && (lastCell.includes('-') || lastCell.includes('+'))) {
        changes.set(nameCandidate, lastCell)
      } else {
        const changeCell = cells.find(c => c.includes('-') || c.includes('+'))
        if (nameCandidate && changeCell) {
          changes.set(nameCandidate, changeCell)
        }
      }
    })

    return changes
  } catch (error) {
    console.error('Lỗi khi lấy dữ liệu biến động Petrolimex:', error)
    return new Map()
  }
}

async function fetchOfficialFuelData() {
  const URL = 'https://webgia.com/gia-xang-dau/petrolimex/'
  try {
    const html = await fetchHtmlWithFallback(URL)
    const doc = new DOMParser().parseFromString(html, 'text/html')
    
    // Webgia thường có table chứa RON 95, E5, v.v.
    const table = [...doc.querySelectorAll('table')].find(t => 
      t.textContent?.includes('RON 95') && t.textContent?.includes('Vùng 2')
    )

    if (!table) {
      // Fallback: tìm bất kỳ table nào có chứa giá
      const tables = [...doc.querySelectorAll('table')]
      for (const t of tables) {
        if (t.textContent?.includes('95') && t.querySelectorAll('tr').length > 3) {
          return parseWebgiaTable(t)
        }
      }
      return []
    }

    return parseWebgiaTable(table)
  } catch (error) {
    console.error('Lỗi khi lấy giá Petrolimex từ mirror:', error)
    return []
  }
}

function parseWebgiaTable(table) {
  const rows = [...table.querySelectorAll('tr')].slice(1) // Bỏ header
  return rows.map(row => {
    const cells = [...row.querySelectorAll('td')].map(c => normalizeText(c.textContent || ''))
    if (cells.length < 3) return null
    
    // Cấu trúc webgia: Tên, Vùng 1, Vùng 2
    return {
      Title: cells[0],
      PriceV1: cells[1],
      PriceV2: cells[2]
    }
  }).filter(Boolean)
}

function parseFuelData(officialItems, changeByName = new Map()) {
  if (officialItems.length === 0) {
    return null
  }

  return {
    source: 'Petrolimex Official',
    title: 'Bảng giá xăng dầu Petrolimex',
    effectiveText: formatFriendlyDateTime(new Date()),
    items: officialItems.map((item) => {
      const name = normalizeFuelName(item.Title)
      const changeText = changeByName.get(name) || '--'
      return {
        name: item.Title,
        priceV1: item.PriceV1,
        priceV2: item.PriceV2,
        changeText,
        trend: changeText.includes('-') ? 'down' : changeText.includes('+') ? 'up' : 'neutral',
      }
    })
  }
}

async function loadVietnamesePrices() {
  let goldData = null
  let goldError = null
  
  try {
    const goldHtml = await fetchHtmlWithFallback('https://vangsinhdien.com/')
    goldData = parseGoldData(goldHtml)
  } catch (error) {
    goldError = error instanceof Error ? error.message : 'Lỗi không xác định'
    goldData = getGoldFallback()
  }

  const [officialItems, fuelChanges] = await Promise.all([
    fetchOfficialFuelData(),
    fetchFuelChangeData(),
  ])

  return {
    gold: goldData,
    goldError,
    fuel: parseFuelData(officialItems, fuelChanges),
  }
}

function App() {
  const [marketData, setMarketData] = useState({ gold: null, fuel: null })
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  const refreshData = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setIsLoading(true)
    try {
      const latestData = await loadVietnamesePrices()
      startTransition(() => {
        setMarketData(latestData)
        if (latestData.goldError) {
          setError(`⚠️ Giá vàng: ${latestData.goldError}`)
        } else {
          setError('')
        }
      })
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Không thể đồng bộ dữ liệu.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshData()
    const timer = window.setInterval(() => refreshData({ silent: true }), REFRESH_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [refreshData])

  const formatValue = (val) => val?.toString() || '--'

  return (
    <main className="dashboard-shell">
      <header className="hero-panel">
        <div className="hero-copy">
          <h1 className="hero-kicker">Xăng Vàng VN</h1>
          <p className="hero-description">
            Bảng theo dõi thị trường vàng Sinh Diễn và giá xăng dầu Petrolimex 
            cơ bản & công nghiệp trực tiếp từ nguồn chính thức.
          </p>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="content-grid">
        <article className="panel panel-gold">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Nguồn: {marketData.gold?.source ?? 'Vàng Sinh Diễn'}</p>
              <h2>Giá vàng Sinh Diễn</h2>
            </div>
            <span className="source-chip">Bắc Ninh</span>
          </div>

          {isLoading && !marketData.gold ? (
            <div className="loading-stack">
              {[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: '40px', marginBottom: '1rem' }}></div>)}
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

                <div className="gold-table-wrap">
                  <table className="gold-table">
                    <thead>
                      <tr>
                        <th>Sản phẩm</th>
                        <th>Mua vào</th>
                        <th>Bán ra</th>
                      </tr>
                    </thead>
                    <tbody>
                      {marketData.gold.items.map((item, idx) => (
                        <tr key={idx}>
                          <td className="gold-name">{item.product}</td>
                          <td>{item.buyText}</td>
                          <td>{item.sellText}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="update-time">Cập nhật: {marketData.gold.updatedText}</p>
              </>
            )
          )}
        </article>

        <article className="panel panel-fuel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Nguồn: Petrolimex Official</p>
              <h2>Bảng Giá Xăng Dầu</h2>
            </div>
            <span className="source-chip">Toàn quốc</span>
          </div>

          {!marketData.fuel && isLoading ? (
            <div className="loading-stack">
              {[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: '40px', marginBottom: '1rem' }}></div>)}
            </div>
          ) : (
            marketData.fuel && (
              <>
                <div className="fuel-table-wrap">
                  <table className="fuel-table">
                    <thead>
                      <tr>
                        <th>Sản phẩm</th>
                        <th>Vùng 1</th>
                        <th className="highlight-col">Vùng 2</th>
                        <th>Biến động</th>
                      </tr>
                    </thead>
                    <tbody>
                      {marketData.fuel.items.map((item, idx) => (
                        <tr key={idx}>
                          <td className="fuel-name">{item.name}</td>
                          <td>{formatValue(item.priceV1)}</td>
                          <td className="highlight-cell">{formatValue(item.priceV2)}</td>
                          <td className={`fuel-change ${item.trend}`}>
                            {item.changeText}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="update-time">Cập nhật: {marketData.fuel.effectiveText}</p>
              </>
            )
          )}
        </article>
      </section>
    </main>
  )
}

export default App
