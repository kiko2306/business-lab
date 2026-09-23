<?php

use App\Helpers\TranslationKeysEnum;
use App\Models\Language;
use App\Models\Translation;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class AddDefaultTranslationValues extends Migration
{
    /**
     * Run the migrations.
     *
     * @return void
     */
    public function up()
    {
        Schema::table('translations', function (Blueprint $table) {
            $language_id = Language::where('code', 'PT')->first()->id;

            // Checkin
            Translation::create([
                'key' => TranslationKeysEnum::CHECKIN_MAIL_SUBJECT,
                'value' => 'Checkin Online',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::CHECKIN_EMAIL_TEXT,
                'value' => '<p>Olá $guest<br>Para sua comodidade, efetue o pré check-in online, preenchendo antecipadamente os dados que são necessários á sua reserva, simplificando e reduzindo o tempo de espera na receção.&nbsp;</p>',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::BTN_CHECKIN,
                'value' => 'Checkin Online',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::CHECKIN_PAGE_TEXT,
                'value' => '<p><span style="background-color:rgb(255,255,255);color:rgb(33,37,41);">Para sua comodidade, efetue o pré check-in online, preenchendo antecipadamente os dados que são necessários á sua reserva, simplificando e reduzindo o tempo de espera na receção.</span></p>',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::CHECKIN_PAGE_SUBMISSION_TEXT,
                'value' => '<p>Obrigado por ter efetuado o check-in.</p>',
                'language_id' => $language_id,
            ]);

            // Quiz
            Translation::create([
                'key' => TranslationKeysEnum::QUIZ_MAIL_SUBJECT,
                'value' => 'Questionário de satisfação.',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::QUIZ_MAIL_TEXT,
                'value' => '<p>Exmo. Hóspede ($guest),<br>A sua comodidade e satisfação é muito importante.<br>Agradecemos-lhe uma breve opinião ao nosso inquérito de satisfação ao cliente.</p>',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::BTN_QUIZ,
                'value' => 'Preencher Questionario',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::QUIZ_PAGE_TEXT,
                'value' => '<p><span style="background-color:rgb(255,255,255);color:rgb(33,37,41);">A sua comodidade e satisfação é muito importante.</span><br><span style="background-color:rgb(255,255,255);color:rgb(33,37,41);">Agradecemos-lhe uma breve opinião ao nosso inquérito de satisfação ao cliente.</span></p>',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::QUIZ_PAGE_SUBMISSION_TEXT,
                'value' => '<p>Obrigado por ter efetuado o questionário.</p>',
                'language_id' => $language_id,
            ]);

            // Birthday
            Translation::create([
                'key' => TranslationKeysEnum::BIRTHDAY_MAIL_SUBJECT,
                'value' => 'Parabéns.',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::BIRTHDAY_MAIL_TEXT,
                'value' => '<p>Esperamos que tenha um ótimo aniversario</p>',
                'language_id' => $language_id,
            ]);

            // Promo
            Translation::create([
                'key' => TranslationKeysEnum::PROMO_MAIL_SUBJECT,
                'value' => 'Título da promoção.',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::PROMO_MAIL_TEXT,
                'value' => '<p>Texto da promoção ativa.</p><p>É possível adicionar imagens.</p>',
                'language_id' => $language_id,
            ]);

            // DATA PROTECTION
            Translation::create([
                'key' => TranslationKeysEnum::DECLARE_CHECKIN_DATA_PROTECTION_TITLE,
                'value' => 'Protecção de dados',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::DECLARE_CHECKIN_DATA_PROTECTION_TEXT,
                'value' => '<p>Texto para Proteção de dados (Importante preencher).</p>',
                'language_id' => $language_id,
            ]);

            // PRIVACY POLICY
            Translation::create([
                'key' => TranslationKeysEnum::DECLARE_CHECKIN_POLICY_READ_TITLE,
                'value' => 'Política de privacidade.',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::DECLARE_CHECKIN_POLICY_READ_TEXT,
                'value' => '<p>Texto para Política de privacidade (Importante preencher).</p>',
                'language_id' => $language_id,
            ]);

            //System
            Translation::create([
                'key' => TranslationKeysEnum::DECLARE_CHECKIN_TRUE_DATA,
                'value' => 'Declaro que todas as informações acima mensionadas são verdadeiras.
                <br>
                Os dados pessoais recolhidos têm em vista o melhor funcionamento do serviço e em conformidade com o regulamento de Protecção de dados.',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::DECLARE_CHECKIN_TERMS_READ,
                'value' => 'Declaro que li e aceito a:',
                'language_id' => $language_id,
            ]);


            Translation::create([
                'key' => TranslationKeysEnum::REQUIRED,
                'value' => 'Obrigatório',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::IGNORE,
                'value' => 'Ignorar',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::RESERVATION_INFO_EMAIL_TITLE,
                'value' => 'Dados da reserva',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::GUEST,
                'value' => 'Hóspede',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::CHECKIN,
                'value' => 'Check-in',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::CHECKOUT,
                'value' => 'Check-out',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::UNIT,
                'value' => 'Unidade',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::OCCUPANTS,
                'value' => 'Ocupantes',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::RESERVATION,
                'value' => 'Reserva',
                'language_id' => $language_id,
            ]);

            // Guest
            Translation::create([
                'key' => TranslationKeysEnum::MAIN_GUEST,
                'value' => 'Hóspede principal',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::OTHER_GUESTS,
                'value' => 'Outros hóspedes',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::NAME,
                'value' => 'Nome',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::LAST_NAME,
                'value' => 'Ultimo nome',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::ADDRESS,
                'value' => 'Morada',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::ZIP_CODE,
                'value' => 'Codigo postal',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::CITY,
                'value' => 'Cidade',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::NATIONALITY,
                'value' => 'Nacionalidade',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::COUNTRY,
                'value' => 'País de residencia',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::PHONE,
                'value' => 'Telefone',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::EMAIL,
                'value' => 'Email',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::VAT,
                'value' => 'Contribuinte',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::GENDER_MALE,
                'value' => 'Masculino',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::GENDER_FEMALE,
                'value' => 'Feminino',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::AGE_GROUP,
                'value' => 'Grupo etário',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::AGE_GROUP_ADULT,
                'value' => 'Adulto',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::AGE_GROUP_CHILD,
                'value' => 'Crianca',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::AGE_GROUP_BABY,
                'value' => 'Bebé',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::CARD_TYPE,
                'value' => 'Documento de identificação',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::CARD_TYPE_ID,
                'value' => 'Bilhete de identidade',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::CARD_TYPE_PASSPORT,
                'value' => 'Passaporte',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::CARD_TYPE_RESIDENCE,
                'value' => 'Autorização de residência',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::CARD_TYPE_DRIVING,
                'value' => 'Carta de condução',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::CARD_TYPE_CITIZEN,
                'value' => 'Cartão de cidadão',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::CARD_TYPE_REFUGEE,
                'value' => 'Visto de refugiado',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::ID_CARD_NUMBER,
                'value' => 'Numero do documento',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::ID_CARD_NUMBER_CONTROL,
                'value' => 'Numero de controlo documento',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::ISSUED_ON,
                'value' => 'Emitido em',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::VALID_UNTIL,
                'value' => 'Valido até',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::PLACE_ISSUE,
                'value' => 'Local de emissão',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::COUNTRY_ISSUE,
                'value' => 'País de Emissão',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::ISSUE_BY,
                'value' => 'Emitido por',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::BIRTH_PLACE,
                'value' => 'Local de nascimento',
                'language_id' => $language_id,
            ]);

            Translation::create([
                'key' => TranslationKeysEnum::BIRTH_DATE,
                'value' => 'Data de nascimento',
                'language_id' => $language_id,
            ]);

        });
    }

    /**
     * Reverse the migrations.
     *
     * @return void
     */
    public function down()
    {
        Schema::table('translations', function (Blueprint $table) {
            Translation::truncate();
        });
    }
}
