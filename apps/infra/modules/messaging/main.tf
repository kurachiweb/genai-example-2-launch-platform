resource "cloudflare_queue" "this" {
  for_each = var.queues

  account_id   = var.account_id
  queue_name   = each.value.name
  jurisdiction = var.jurisdiction
}
