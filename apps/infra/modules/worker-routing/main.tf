resource "cloudflare_workers_custom_domain" "this" {
  for_each = var.domains

  account_id = var.account_id
  zone_id    = var.zone_id
  hostname   = each.value.hostname
  service    = each.value.service
}
