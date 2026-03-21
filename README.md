# Bang gia vang va dau realtime

Web tool duoc xay dung bang Vite + React de theo doi gia vang quoc te va dau tho WTI voi co che tu dong cap nhat moi 30 giay.

## Tinh nang

- Hien thi gia vang quoc te tu ma GC=F
- Hien thi gia dau tho WTI tu ma CL=F
- Tu dong refresh moi 30 giay
- Co nut cap nhat thu cong
- Hien thi bien dong, bien do ngay, khoi luong va mini chart
- Giao dien responsive cho desktop va mobile

## Nguon du lieu

- Du lieu goc lay tu Yahoo Finance chart API
- Frontend dung `https://api.allorigins.win/raw` de vuot qua gioi han CORS khi goi tu trinh duyet
- Gia hien thi theo USD va phan anh thi truong hop dong tuong lai quoc te

Luu y: Neu ban can gia xang dau ban le tai Viet Nam, can thay hoac bo sung nguon du lieu noi dia co API on dinh.

## Chay local

```bash
npm install
npm run dev
```

## Build production

```bash
npm run build
```

## Cau truc chinh

- `src/App.jsx`: logic lay du lieu, polling va giao dien dashboard
- `src/App.css`: style cho cac card, hero va chart mini
- `src/index.css`: token mau sac va global layout
