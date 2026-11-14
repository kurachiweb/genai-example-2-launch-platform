variable "account_id" {
  type = string
}

variable "zone_id" {
  type = string
}

variable "domains" {
  type = map(object({
    hostname = string
    service  = string
  }))
}
