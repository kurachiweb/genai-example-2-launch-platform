output "hostnames" {
  value = { for k, d in cloudflare_workers_custom_domain.this : k => d.hostname }
}

output "placement" {
  value = {
    account_ids = toset([for d in cloudflare_workers_custom_domain.this : d.account_id])
    zone_ids    = toset([for d in cloudflare_workers_custom_domain.this : d.zone_id])
  }
}
