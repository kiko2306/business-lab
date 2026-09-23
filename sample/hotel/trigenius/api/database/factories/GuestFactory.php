<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;

class GuestFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array
     */
    public function definition()
    {
        return [
            'code' => $this->faker->unique()->numberBetween(0, 99999),
            'name' => $this->faker->name,
            'last_name' => $this->faker->optional()->lastName,
            'address1' => $this->faker->optional()->address,
            'address2' => $this->faker->optional()->text(30),
            'address3' => $this->faker->optional()->text(30),
            'zip_code' => $this->faker->optional()->postcode,
            'city' => $this->faker->optional()->city,
            'country' => $this->faker->optional()->countryCode,
            'phone' => $this->faker->optional()->phoneNumber,
            'email' => $this->faker->optional()->email,
            'nif' => $this->faker->unique()->numberBetween(100000000, 999999999),
            'gender' => $this->faker->numberBetween(0, 1),
            'doc' => $this->faker->numberBetween(1, 5),
            'doc_number' => $this->faker->unique()->numberBetween(100000000, 999999999),
            'doc_number_id_control' => $this->faker->numberBetween(1, 9),
            'doc_date' => $this->faker->dateTimeBetween('-10 years', '-1 years'),
            'doc_valid' => $this->faker->dateTimeBetween('-1 years', '5 years'),
            'doc_local' => $this->faker->city,
            'doc_country' => $this->faker->countryCode,
            'doc_by' => $this->faker->city,
            'birth_local' => $this->faker->city,
            'birth_date' => $this->faker->dateTimeBetween('-80 years', '-18 years'),
            'nationality' => $this->faker->countryCode,
            'mailable' => $this->faker->boolean(75),
            'has_changes' => $this->faker->boolean(1),
        ];
    }
}
