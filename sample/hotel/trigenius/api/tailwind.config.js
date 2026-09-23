/** @type {import('tailwindcss').Config} */
const defaultTheme = require('tailwindcss/defaultTheme');

module.exports = {
    content: [
        './vendor/laravel/framework/src/Illuminate/Pagination/resources/views/*.blade.php',
        './storage/framework/views/*.php',
        './resources/views/**/*.blade.php',
        './vendor/wire-elements/modal/resources/views/*.blade.php',
        './vendor/wire-elements/modal/src/ModalComponent.php'
    ],
    options: {
        safelist: [
            "sm:max-w-sm",
            "sm:max-w-md",
            "md:max-w-lg",
            "md:max-w-xl",
            "lg:max-w-2xl",
            "lg:max-w-3xl",
            "xl:max-w-4xl",
            "xl:max-w-5xl",
            "2xl:max-w-6xl",
            "2xl:max-w-7xl",
        ]
    },
    theme: {
        extend: {
            fontFamily: {
                sans: ['Nunito', ...defaultTheme.fontFamily.sans],
            },
        },
    },

    plugins: [require('@tailwindcss/forms')],
};
