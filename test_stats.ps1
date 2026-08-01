$body = @{ adminKey = '8023.520' } | ConvertTo-Json
$r = Invoke-RestMethod -Uri 'https://inventory-app-9ql.pages.dev/admin/stats' -Method Post -ContentType 'application/json' -Body $body
$r | ConvertTo-Json -Depth 5
