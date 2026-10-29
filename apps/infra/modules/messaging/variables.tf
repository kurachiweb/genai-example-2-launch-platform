variable "account_id" {
  type = string
}

variable "jurisdiction" {
  type = string

  validation {
    condition     = contains(["us", "eu", "fedramp"], var.jurisdiction)
    error_message = "jurisdictionは\"us\"・\"eu\"・\"fedramp\"のいずれかにする。"
  }
}

variable "queues" {
  type = map(object({ name = string }))
}
