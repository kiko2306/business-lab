<?php

use Illuminate\Http\Request;

return [
    'proxies' => '*',
    'headers' => Request::HEADER_X_FORWARDED_ALL,
];
