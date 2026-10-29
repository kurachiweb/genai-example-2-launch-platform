resource "cloudflare_d1_database" "this" {
  for_each = var.databases

  account_id   = var.account_id
  name         = each.value.name
  jurisdiction = var.jurisdiction
  read_replication = {
    mode = "disabled"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_r2_bucket" "this" {
  for_each = var.buckets

  account_id    = var.account_id
  name          = each.value.name
  jurisdiction  = var.jurisdiction
  storage_class = "Standard"

  lifecycle {
    prevent_destroy = true
  }
}
