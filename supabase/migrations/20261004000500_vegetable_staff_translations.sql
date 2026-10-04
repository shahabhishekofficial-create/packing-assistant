-- Add staff-friendly Hindi and Gujarati names.
-- English remains the default language in the staff UI.

update public.inv_vegetable_items set
name_hi = case name_en
when 'Arugula' then 'अरुगुला' when 'Asparagus' then 'एस्पैरेगस' when 'Avocado' then 'एवोकाडो'
when 'Baby Corn' then 'बेबी कॉर्न' when 'Baby Spinach' then 'बेबी पालक' when 'Bok Choy' then 'बोक चॉय'
when 'Broccoli' then 'ब्रोकोली' when 'Brussels Sprouts' then 'ब्रसेल्स स्प्राउट्स' when 'Button Mushroom' then 'बटन मशरूम'
when 'Celery' then 'सेलेरी' when 'Cherry Tomato' then 'चेरी टमाटर' when 'Chinese Cabbage' then 'चीनी पत्तागोभी'
when 'Chives (Imported)' then 'चाइव्स (इम्पोर्टेड)' when 'Dill Leaves' then 'डिल लीव्स' when 'Edamame No Pods' then 'एडामेमे बिना फली'
when 'Edamame With Pods' then 'एडामेमे फली सहित' when 'Edible Flower' then 'खाने योग्य फूल' when 'Enoki Mushroom' then 'एनोकि मशरूम'
when 'Fennel' then 'सौंफ' when 'Green Capsicum' then 'हरी शिमला मिर्च' when 'Green Zucchini' then 'हरी ज़ुकीनी'
when 'Iceberg' then 'आइसबर्ग लेट्यूस' when 'Italian Basil' then 'इटालियन बेसिल' when 'Kale' then 'केल'
when 'Leek' then 'लीक' when 'Lemongrass' then 'लेमनग्रास' when 'Lettuce Green' then 'हरा लेट्यूस'
when 'Lollo Rosso' then 'लोलो रोसो लेट्यूस' when 'Lotus Stem' then 'कमल ककड़ी' when 'Microgreens' then 'माइक्रोग्रीन्स'
when 'Oyster Mushroom' then 'ऑयस्टर मशरूम' when 'Parsley' then 'पार्सले' when 'Red Bell Pepper' then 'लाल शिमला मिर्च'
when 'Red Cabbage' then 'लाल पत्तागोभी' when 'Red Yellow Bell Peppers' then 'लाल और पीली शिमला मिर्च' when 'Rocket Leaves' then 'रॉकेट लीव्स'
when 'Romaine Lettuce' then 'रोमेन लेट्यूस' when 'Rosemary' then 'रोज़मेरी' when 'Simpson Lettuce' then 'सिम्पसन लेट्यूस'
when 'Snow Peas' then 'स्नो पीज़' when 'Spring Onion' then 'हरा प्याज़' when 'Thai Chilli' then 'थाई मिर्च'
when 'Thai Ginger' then 'थाई अदरक' when 'Thyme' then 'थाइम' when 'Yellow Bell Pepper' then 'पीली शिमला मिर्च'
when 'Yellow Zucchini' then 'पीली ज़ुकीनी' else name_hi end,
name_gu = case name_en
when 'Arugula' then 'અરુગુલા' when 'Asparagus' then 'એસ્પેરેગસ' when 'Avocado' then 'એવોકાડો'
when 'Baby Corn' then 'બેબી કોર્ન' when 'Baby Spinach' then 'બેબી પાલક' when 'Bok Choy' then 'બોક ચોય'
when 'Broccoli' then 'બ્રોકોલી' when 'Brussels Sprouts' then 'બ્રસેલ્સ સ્પ્રાઉટ્સ' when 'Button Mushroom' then 'બટન મશરૂમ'
when 'Celery' then 'સેલરી' when 'Cherry Tomato' then 'ચેરી ટમેટાં' when 'Chinese Cabbage' then 'ચાઇનીઝ કોબી'
when 'Chives (Imported)' then 'ચાઇવ્સ (ઇમ્પોર્ટેડ)' when 'Dill Leaves' then 'ડિલ લીવ્સ' when 'Edamame No Pods' then 'એડામેમે વગરની ફળી'
when 'Edamame With Pods' then 'ફળી સાથેનું એડામેમે' when 'Edible Flower' then 'ખાદ્ય ફૂલ' when 'Enoki Mushroom' then 'એનોકી મશરૂમ'
when 'Fennel' then 'વરિયાળી' when 'Green Capsicum' then 'લીલું શિમલા મરચું' when 'Green Zucchini' then 'લીલી ઝુકીની'
when 'Iceberg' then 'આઇસબર્ગ લેટીસ' when 'Italian Basil' then 'ઇટાલિયન બેસિલ' when 'Kale' then 'કેલ'
when 'Leek' then 'લીક' when 'Lemongrass' then 'લેમનગ્રાસ' when 'Lettuce Green' then 'ગ્રીન લેટીસ'
when 'Lollo Rosso' then 'લોલો રોસો લેટીસ' when 'Lotus Stem' then 'કમળ કાકડી' when 'Microgreens' then 'માઇક્રોગ્રીન્સ'
when 'Oyster Mushroom' then 'ઓઇસ્ટર મશરૂમ' when 'Parsley' then 'પાર્સલી' when 'Red Bell Pepper' then 'લાલ શિમલા મરચું'
when 'Red Cabbage' then 'લાલ કોબી' when 'Red Yellow Bell Peppers' then 'લાલ અને પીળા શિમલા મરચાં' when 'Rocket Leaves' then 'રોકેટ લીફ્સ'
when 'Romaine Lettuce' then 'રોમેન લેટીસ' when 'Rosemary' then 'રોઝમેરી' when 'Simpson Lettuce' then 'સિમ્પસન લેટીસ'
when 'Snow Peas' then 'સ્નો પીઝ' when 'Spring Onion' then 'લીલી ડુંગળી' when 'Thai Chilli' then 'થાઇ મરચું'
when 'Thai Ginger' then 'થાઇ આદુ' when 'Thyme' then 'થાઇમ' when 'Yellow Bell Pepper' then 'પીળું શિમલા મરચું'
when 'Yellow Zucchini' then 'પીળી ઝુકીની' else name_gu end
where name_en in ('Arugula','Asparagus','Avocado','Baby Corn','Baby Spinach','Bok Choy','Broccoli','Brussels Sprouts','Button Mushroom','Celery','Cherry Tomato','Chinese Cabbage','Chives (Imported)','Dill Leaves','Edamame No Pods','Edamame With Pods','Edible Flower','Enoki Mushroom','Fennel','Green Capsicum','Green Zucchini','Iceberg','Italian Basil','Kale','Leek','Lemongrass','Lettuce Green','Lollo Rosso','Lotus Stem','Microgreens','Oyster Mushroom','Parsley','Red Bell Pepper','Red Cabbage','Red Yellow Bell Peppers','Rocket Leaves','Romaine Lettuce','Rosemary','Simpson Lettuce','Snow Peas','Spring Onion','Thai Chilli','Thai Ginger','Thyme','Yellow Bell Pepper','Yellow Zucchini');